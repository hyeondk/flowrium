const test=require("node:test"),assert=require("node:assert/strict");
const {preferences,chatAddress}=require("../electron/chat-preferences.cjs");
test("대화별 모델과 자신의 ChatGPT 대화 주소만 저장한다",()=>{
 const id="11111111-2222-3333-4444-555555555555";
 assert.deepEqual(preferences({model:"test-model",effort:"high",chatGptUrl:"https://chatgpt.com/c/"+id+"?source=test"}),{model:"test-model",effort:"high",chatGptUrl:"https://chatgpt.com/c/"+id});
 assert.deepEqual(preferences({}),{});
 for (const address of ["https://chatgpt.com.evil.test/c/"+id,"https://other@chatgpt.com/c/"+id,"file:///c/"+id,"https://chatgpt.com/share/"+id]) assert.throws(()=>chatAddress(address));
 assert.throws(()=>preferences({effort:"wrong"}));
});
