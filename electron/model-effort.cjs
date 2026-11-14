const EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max','ultra']);
function supportedEffort(requested,model,rows){
 if(!Array.isArray(rows))return undefined;
 const metadata=model?rows.find(row=>row&&(row.model===model||row.id===model)):rows.find(row=>row?.isDefault===true);
 const supported=Array.isArray(metadata?.supportedReasoningEfforts)?metadata.supportedReasoningEfforts.map(row=>row?.reasoningEffort).filter(value=>EFFORTS.has(value)):[];
 if(!supported.length)return undefined;
 if(supported.includes(requested))return requested;
 return supported.includes(metadata.defaultReasoningEffort)?metadata.defaultReasoningEffort:undefined;
}
module.exports={supportedEffort};
