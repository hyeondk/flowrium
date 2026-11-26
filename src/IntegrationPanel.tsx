import NativePimPanel from './NativePimPanel';
import GoogleConnectionPanel from './GoogleConnectionPanel';
import LinkDeliveryPanel from './LinkDeliveryPanel';
import './integrations.css';
export default function IntegrationPanel(_props:{projectId?:string}){return <><NativePimPanel/><GoogleConnectionPanel/><LinkDeliveryPanel/></>;}
