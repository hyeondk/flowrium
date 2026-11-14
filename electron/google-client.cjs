function publishedGoogleClient(value){
 if(value==null)return null;
 if(typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['clientId','clientSecret'].includes(key))&&value.clientId==='')return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['clientId','clientSecret'].includes(key))||typeof value.clientId!=='string'||!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId)||value.clientId.length>300||typeof(value.clientSecret??'')!=='string'||(value.clientSecret||'').length>500||/[\x00-\x1f]/.test(value.clientSecret||''))throw Error('배포용 Google 데스크톱 클라이언트 설정을 확인해 주세요.');
 return{clientId:value.clientId,clientSecret:value.clientSecret||''};
}
function fromDownloadedClient(value){
 if(!value||typeof value!=='object'||!value.installed||value.web||value.private_key||value.access_token||value.refresh_token)throw Error('Google에서 내려받은 데스크톱 앱 OAuth 파일을 선택해 주세요.');
 return publishedGoogleClient({clientId:value.installed.client_id,clientSecret:value.installed.client_secret||''});
}
module.exports={publishedGoogleClient,fromDownloadedClient};
