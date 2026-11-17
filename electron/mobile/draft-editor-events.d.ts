export function attachDraftEditor(input:HTMLTextAreaElement,options:{
  read:()=>string;
  change:(text:string)=>void;
  render:(view:{page:number;count:number})=>void;
}):{refresh:()=>void;go:(page:number)=>void;dispose:()=>void};
