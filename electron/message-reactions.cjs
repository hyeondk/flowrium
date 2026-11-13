const {text}=require('./store.cjs');
function registerMessageReactions(register,store,options={}){
  register('reactMessage',async input=>{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['sessionId','messageId','liked'].includes(key))||typeof input.liked!=='boolean')throw Error('메시지 반응을 확인해 주세요.');
    if(options.canRun?.()===false)throw Error('현재 메시지 반응을 저장할 수 없습니다.');
    const revision=options.accountRevision?.(),session=store.session(text(input.sessionId,'대화 식별자',100)),message=session.messages.find(row=>row.id===text(input.messageId,'메시지 식별자',100));
    if(!message||message.role!=='assistant')throw Error('답변 메시지를 선택해 주세요.');
    const previous=message.reaction,updated=session.updatedAt,stamp=new Date().toISOString();
    if(input.liked)message.reaction='like';else delete message.reaction;
    session.updatedAt=stamp;
    try{await store.save()}catch(error){if(message.reaction===(input.liked?'like':undefined)){if(previous)message.reaction=previous;else delete message.reaction;}if(session.updatedAt===stamp)session.updatedAt=updated;throw error;}
    if(options.canRun?.()===false||revision!==options.accountRevision?.())throw Error('계정이나 잠금 상태가 바뀌었습니다.');
    return structuredClone(store.session(session.id));
  });
}
module.exports={registerMessageReactions};
