const {createHash} = require('node:crypto');
const {PassThrough} = require('node:stream');
const {storeRequestSource} = require('./chat-attachments.cjs');

const chunkBytes = 1024 * 1024;
const singleUploadBytes = 20 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest();
const invalid = () => Error('긴 요청의 전송 위치와 원문을 다시 확인해 주세요.');

// One writer streams into the normal immutable request store. Each authenticated
// HTTP part can disconnect or repeat independently of the writer and Codex turn.
class MobileRequestUploads {
  constructor(save=storeRequestSource,idleMs=15*60*1000) { this.save=save; this.rows=new Map(); this.idleMs=idleMs; }
  async legacy(key,bytes,store,projectId,guard) {
    const first=this.begin(key,bytes.length,store,projectId,guard),row=this.rows.get(key);
    if(row.record)return row.record;
    if(!row.legacy)row.legacy=(async()=>{
      for(let offset=first.offset;offset<bytes.length;offset+=chunkBytes){
        const part=bytes.subarray(offset,offset+chunkBytes);
        await this.part(key,offset,part,digest(part).toString('hex'));
      }
      return this.finish(key,row.chain.toString('hex'));
    })();
    return row.legacy;
  }
  begin(key,size,store,projectId,guard) {
    if(!Number.isSafeInteger(size)||size<1)throw invalid();
    let row=this.rows.get(key);
    if(row?.error){this.discard(key).catch(()=>{});row=undefined;}
    if(!row){
      const active=[...this.rows.values()].filter(item=>!item.published);
      if(active.length>=4)throw Error('진행 중인 원문 전송이 끝난 뒤 다시 시도해 주세요.');
      if(this.rows.size>=36){
        const oldest=[...this.rows].find(entry=>entry[1].published);
        if(oldest)this.discard(oldest[0]).catch(()=>{});
      }
      const stream=new PassThrough({highWaterMark:chunkBytes});
      stream.on('error',()=>{});
      row={stream,size,offset:0,stagedOffset:0,chain:Buffer.alloc(32),hash:createHash('sha256')};
      this.rows.set(key,row);
      const onStagedBytes=length=>{
        row.stagedOffset+=length;
        if(row.writing && row.stagedOffset>=row.writing.end)row.writing.resolve();
      };
      row.saved=Promise.resolve().then(()=>this.save(store,projectId,stream,{guard,defer:true,onStagedBytes})).catch(error=>{
        row.error=error;row.writing?.reject(error);stream.destroy(error);throw error;
      });
      row.saved.catch(()=>{});
    }
    if(row.size!==size)throw invalid();
    this.refresh(key,row);
    return {offset:row.offset,chain:row.chain.toString('hex'),chunkBytes};
  }
  refresh(key,row) {
    clearTimeout(row.timer);
    row.timer=setTimeout(()=>this.discard(key).catch(()=>{}),this.idleMs);row.timer.unref();
  }
  async part(key,offset,bytes,checksum) {
    const row=this.rows.get(key);
    if(!row||row.error||row.busy||row.finishing||!Number.isSafeInteger(offset)||offset<0 ||
      bytes.length!==Math.min(chunkBytes,row.size-offset)||bytes.length===0)throw invalid();
    const sum=digest(bytes);
    if(checksum!==sum.toString('hex'))throw invalid();
    if(row.lastOffset===offset && row.lastChecksum===checksum)return {offset:row.offset};
    if(offset!==row.offset || row.record)throw invalid();
    row.busy=true;this.refresh(key,row);
    // A PassThrough write only means the buffer was accepted. Wait for the
    // guarded UTF-8 writer to receive and store this part before confirming it.
    const writing=Promise.withResolvers();
    row.writing={...writing,end:offset+bytes.length};
    try{
      await Promise.all([
        new Promise((resolve,reject)=>row.stream.write(bytes,error=>error?reject(error):resolve())),
        writing.promise,
      ]);
      if(row.error)throw row.error;
      row.chain=digest(Buffer.concat([row.chain,sum]));row.hash.update(bytes);
      row.lastOffset=offset;row.lastChecksum=checksum;row.offset+=bytes.length;
      return {offset:row.offset};
    }finally{row.writing=undefined;row.busy=false;}
  }
  async finish(key,expected) {
    const row=this.rows.get(key);
    if(!row || row.busy || row.offset!==row.size || row.chain.toString('hex')!==expected)throw invalid();
    if(row.error)throw row.error;
    if(row.record)return row.record;
    if(!row.finishing){
      this.refresh(key,row);row.stream.end();
      row.finishing=row.saved.then(record=>{
        if(record.size!==row.size || record.sha256!==row.hash.digest('hex'))throw invalid();
        row.record={id:record.id,size:record.size,sha256:record.sha256};
        return row.record;
      });
    }
    return row.finishing;
  }
  async publish(key,id){
    const row=this.rows.get(key);
    if(!row)return;
    if(!row.record || row.record.id!==id)throw invalid();
    // A duplicate send waits for the same publish. The controller separately
    // coalesces the submission ID before starting the model.
    if(!row.publishing)row.publishing=row.saved.then(stage=>stage.publish()).then(()=>{
      row.published=true;
    }).catch(error=>{row.publishing=undefined;throw error;});
    await row.publishing;
    return true;
  }
  async discard(key) {
    const row=this.rows.get(key);
    if(!row)return;
    this.rows.delete(key);clearTimeout(row.timer);
    if(!row.record)row.stream.destroy(Error('긴 요청 전송이 취소됐습니다.'));
    if(row.publishing)await row.publishing.catch(()=>{});
    const stage=await row.saved.catch(()=>null);
    await stage?.discard();
  }
  clear(){return Promise.all([...this.rows.keys()].map(key=>this.discard(key)));}
}
module.exports={MobileRequestUploads,chunkBytes,singleUploadBytes};
