const https=require('node:https');
const {BlockList,isIPv4}=require('node:net');

const nonPublic=new BlockList();
for(const [network,mask] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',3]])nonPublic.addSubnet(network,mask);

function requestIPv4(url,address,{signal},get){
  return new Promise((resolve,reject)=>{
    const req=get(url,{signal,agent:false,family:4,autoSelectFamily:false,servername:url.hostname,rejectUnauthorized:true,
      lookup(_hostname,_options,callback){callback(null,address,4);},
    },res=>{
      if(res.statusCode!==200||Number(res.headers['content-length'])!==64){
        res.resume();resolve(new Response(null,{status:502}));return;
      }
      const chunks=[];
      let length=0;
      res.on('error',reject);
      res.on('data',chunk=>{
        length+=chunk.length;
        if(length>64){res.destroy(Error('중계 확인 응답 크기가 올바르지 않습니다.'));return;}
        chunks.push(chunk);
      });
      res.once('end',()=>resolve(new Response(Buffer.concat(chunks),{status:200,headers:{'content-length':String(length)}})));
    });
    req.once('error',reject);
  });
}

async function fetchRelayProbe(input,options,fetchImpl=fetch,getHttps=https.get){
  const url=new URL(input);
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.search||url.hash||
     !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)||!/^\/relay-check\/[a-f\d-]{36}$/.test(url.pathname))
    throw Error('새 휴대폰 중계의 확인 주소가 올바르지 않습니다.');
  try{return await fetchImpl(url,options);}catch(error){
    if((error.cause?.code??error.code)!=='ENOTFOUND')throw error;
  }
  // The system resolver can cache an early NXDOMAIN while a new public relay
  // propagates. Ask the tunnel provider's public resolver about that host only.
  const query=new URL('https://cloudflare-dns.com/dns-query');
  query.searchParams.set('name',url.hostname);query.searchParams.set('type','A');
  const result=await fetchImpl(query,{signal:options.signal,redirect:'error',headers:{accept:'application/dns-json'}});
  if(!result.ok){await result.body?.cancel();return result;}
  const dns=await result.json();
  const address=dns.Status===0&&dns.Answer?.find(record=>record.type===1&&record.name?.replace(/\.$/,'')===url.hostname&&
    isIPv4(record.data)&&!nonPublic.check(record.data))?.data;
  if(!address)return new Response(null,{status:502});
  return requestIPv4(url,address,options,getHttps);
}

module.exports={fetchRelayProbe};
