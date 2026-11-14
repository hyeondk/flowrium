export interface LinkDeliveryState {
  configured:boolean; hasSecret:boolean; connected:boolean; authorizing:boolean;
  redirectUri:string; webDomain:string; autoKakao:boolean; ttlMinutes:5|15|60;
  sentToday:number; dailyMax:number; nativeAvailable:boolean;
  last?:{at:number;channel:string;ok:boolean;error?:string;to?:string};
  mail:{enabled:boolean;provider:'mac';senders:string[];phrase:string};
}
export interface LinkDeliveryInput {
  restKey?:string; clientSecret?:string; ttlMinutes?:5|15|60; autoKakao?:boolean;
  mail?:LinkDeliveryState['mail'];
}
export interface LinkDeliveryAPI {
  linkDeliveryState():Promise<LinkDeliveryState>;
  configureLinkDelivery(input:LinkDeliveryInput):Promise<LinkDeliveryState>;
  connectKakao():Promise<void>;disconnectKakao():Promise<LinkDeliveryState>;
  sendKakaoLink():Promise<LinkDeliveryState>;sendLinkMail(to:string):Promise<LinkDeliveryState>;
  checkLinkMail():Promise<LinkDeliveryState>;
}
