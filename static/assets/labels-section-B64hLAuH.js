import{d as ce,k as ue,j as e,v as be,ah as he,x as ge}from"./index-Bi2FKojS.js";import{g as fe,r as i}from"./react-DS8arpni.js";import{C as ie}from"./cantidad-DI-ZDH4S.js";import{B as ve}from"./button-oYu7jBl4.js";import{r as je}from"./scanner-Dh8vzQln.js";import{C as ye}from"./chevron-down-QDqjcbBK.js";import{C as Ne}from"./chevron-up-DnP9xDf-.js";/**
 * @license lucide-react v0.577.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const we=[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]],ke=ce("printer",we);/**
 * @license lucide-react v0.577.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ce=[["path",{d:"M15 12h-5",key:"r7krc0"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]],_e=ce("scroll-text",Ce);var $e=je();const Me=fe($e);async function qe(x,o={formato:"rollo",rolloTamano:"50x25",mostrarBordes:!0}){var M,A,q,I;const y=o.formato==="rollo";let l=50,c=25,w=50,h=25,u=1,g=1,N=0,z=0,$=0,P=0,T=0;if(y){const s=o.rolloTamano||"50x25";s==="50x25"?(l=50,c=25):s==="40x30"?(l=40,c=30):s==="60x40"?(l=60,c=40):s==="80x50"?(l=80,c=50):(l=o.rolloAnchoCustom||50,c=o.rolloAltoCustom||25),w=l,h=c}else{const s=o.hojaTamano||"carta";s==="carta"?(l=215.9,c=279.4):s==="oficio"?(l=216,c=330):s==="a4"&&(l=210,c=297);const d=o.hojaDiseno||"3x10";d==="3x10"?(u=3,g=10):d==="3x8"?(u=3,g=8):d==="4x10"?(u=4,g=10):(u=o.hojaColumnas||3,g=o.hojaFilas||10),N=o.margenX!==void 0?o.margenX:10,z=o.margenY!==void 0?o.margenY:10,$=o.espacioX!==void 0?o.espacioX:2,P=o.espacioY!==void 0?o.espacioY:2,T=Math.max(0,(o.posicionInicial||1)-1),w=(l-2*N-$*(u-1))/u,h=(c-2*z-P*(g-1))/g}const H=[];for(const s of x){const d=(M=s.lote_id)==null?void 0:M.trim();if(!d)continue;const f=await Me.toDataURL(d,{width:128,margin:1,errorCorrectionLevel:"M"}),C=s.fecha_vencimiento?new Date(s.fecha_vencimiento+"T00:00:00").toLocaleDateString(ue,{day:"2-digit",month:"2-digit",year:"2-digit"}):"—",v=s.presentacion_nombre||"",j=w>60?38:28,F=s.producto_nombre.length>j?s.producto_nombre.slice(0,j-2)+"…":s.producto_nombre,_=`
      <div class="label-cell">
        <img class="qr" src="${f}" alt="QR ${s.numero_lote}" />
        <div class="info">
          <div class="nombre">${F}</div>
          <div class="sub">${v?v+" · ":""}${s.area_nombre}</div>
          <div class="lote">Lote: ${s.numero_lote}</div>
          <div class="vence">Vence: ${C}</div>
        </div>
      </div>`;for(let S=0;S<s.cantidad_etiquetas;S++)H.push(_)}let D="";if(y)D=H.map(s=>s).join(`
`);else{const s=[],d=u*g;let f=0,C=!0;for(;f<H.length;){const v=[];let j=0;if(C){j=T;for(let S=0;S<j;S++)v.push('<div class="label-empty"></div>');C=!1}const F=d-j,_=H.slice(f,f+F);for(v.push(..._),f+=_.length;v.length<d;)v.push('<div class="label-empty"></div>');s.push(`
        <div class="page">
          ${v.join(`
`)}
        </div>
      `)}D=s.join(`
`)}const X=Math.min(w*.35,h*.72),k=Math.min(12,Math.max(5.5,h*.22)),Q=Math.min(10,Math.max(4.5,h*.18)),b=Math.min(11,Math.max(5,h*.2)),B=o.mostrarBordes??!!y,G=`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
${`
    @page {
      size: ${l}mm ${c}mm;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: Arial, sans-serif;
      background: white;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    /* Rollo */
    .label-cell {
      width: ${w}mm;
      height: ${h}mm;
      display: flex;
      align-items: center;
      gap: 2mm;
      padding: 1.5mm;
      overflow: hidden;
      background: white;
      box-sizing: border-box;
      ${y?"page-break-after: always;":""}
      ${B?"border: 0.25mm solid #ccc;":"border: none;"}
    }
    ${y?".label-cell:last-child { page-break-after: avoid; }":""}

    /* Hoja */
    .page {
      width: ${l}mm;
      height: ${c}mm;
      padding: ${z}mm ${N}mm;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(${u}, 1fr);
      grid-template-rows: repeat(${g}, 1fr);
      gap: ${P}mm ${$}mm;
      page-break-after: always;
      overflow: hidden;
      background: white;
    }
    .page:last-child {
      page-break-after: avoid;
    }
    .label-empty {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: transparent;
      ${B?"border: 0.15mm dashed #ddd;":"border: none;"}
    }
    
    /* Elementos Internos */
    .qr {
      width: ${X}mm;
      height: ${X}mm;
      flex-shrink: 0;
    }
    .info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .nombre {
      font-size: ${k}pt;
      font-weight: bold;
      line-height: 1.25;
      margin-bottom: 0.4mm;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sub {
      font-size: ${Q}pt;
      color: #555;
      margin-bottom: 0.4mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lote {
      font-size: ${b}pt;
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vence {
      font-size: ${b}pt;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `}
</style>
</head>
<body>
${D}
</body>
</html>`,p=document.createElement("iframe");p.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0",document.body.appendChild(p);const L=p.contentDocument||((A=p.contentWindow)==null?void 0:A.document);if(!L){document.body.removeChild(p);return}L.open(),L.write(G),L.close();const R=p.contentDocument||((q=p.contentWindow)==null?void 0:q.document);if(R){const s=Array.from(R.querySelectorAll("img"));await Promise.all(s.map(d=>d.complete?Promise.resolve():new Promise(f=>d.addEventListener("load",()=>f(),{once:!0}))))}(I=p.contentWindow)==null||I.print(),setTimeout(()=>document.body.removeChild(p),2e3)}function ne(x,o){return o==="simple"?!0:!!(x.codigo_lote&&x.fecha_vencimiento)}function Pe(x){return!!(x.area_destino_id&&x.lotes.length>0&&x.lotes.every(o=>ne(o,x.control_lote)))}function Te({detalles:x,onToggleEtiqueta:o,onCantidadEtiqueta:y,lotesConfirmados:l,onAfterPrint:c}){const[w,h]=i.useState(!1),[u,g]=i.useState(!1),[N,z]=i.useState("rollo"),[$,P]=i.useState("50x25"),[T,H]=i.useState(50),[D,X]=i.useState(25),[k,Q]=i.useState("carta"),[b,B]=i.useState("3x10"),[E,G]=i.useState(3),[p,L]=i.useState(10),[R,M]=i.useState(1),[A,q]=i.useState(!0),[I,s]=i.useState(!1),[d,f]=i.useState(10),[C,v]=i.useState(10),[j,F]=i.useState(2),[_,S]=i.useState(2),[de,me]=i.useState(()=>(l??[]).map(a=>Math.max(1,Math.round(a.cantidad_etiquetas))));if(l){const a=t=>de[t]??Math.max(1,Math.round(l[t].cantidad_etiquetas)),m=l.reduce((t,n,r)=>t+a(r),0),K=(t,n)=>{const r=Math.max(1,Math.min(999,Math.round(n)||1));me(se=>{const W=l.map((Se,re)=>se[re]??a(re));return W[t]=r,W})},pe=async()=>{h(!0);try{await qe(l.map((t,n)=>({...t,cantidad_etiquetas:a(n)})),{formato:N,rolloTamano:$,rolloAnchoCustom:T,rolloAltoCustom:D,hojaTamano:k,hojaDiseno:b,hojaColumnas:E,hojaFilas:p,posicionInicial:R,mostrarBordes:A,margenY:d,margenX:C,espacioX:j,espacioY:_}),c==null||c()}catch{ge.error("Error al generar etiquetas")}finally{h(!1)}},U=b==="3x10"||b==="3x8"?3:b==="4x10"?4:E,O=b==="3x10"?10:b==="3x8"?8:b==="4x10"?10:p,Y=U*O,Z=Math.min(Y-1,Math.max(0,R-1)),ee=m,V=[];for(let t=0;t<Y;t++)t<Z?V.push("skipped"):t<Z+ee?V.push("printed"):V.push("empty");const te=k==="carta"?215.9:k==="oficio"?216:210,ae=k==="carta"?279.4:k==="oficio"?330:297,le=Math.ceil((ee+Z)/Y);return e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-2 bg-base-200 p-1 rounded-xl",children:[e.jsxs("button",{type:"button",className:`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all gap-1.5 ${N==="rollo"?"bg-primary text-primary-content hover:bg-primary/95":"bg-transparent text-base-content/60 hover:bg-base-300"}`,onClick:()=>{z("rollo"),q(!0)},children:[e.jsx(_e,{className:"h-3.5 w-3.5"}),"Rollo de etiquetas"]}),e.jsxs("button",{type:"button",className:`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all gap-1.5 ${N==="hoja"?"bg-primary text-primary-content hover:bg-primary/95":"bg-transparent text-base-content/60 hover:bg-base-300"}`,onClick:()=>{z("hoja"),q(!1)},children:[e.jsx(be,{className:"h-3.5 w-3.5"}),"Hoja común"]})]}),e.jsx("div",{className:"card bg-base-100 border border-base-200 p-4 space-y-4 shadow-sm",children:N==="rollo"?e.jsxs("div",{className:"space-y-3",children:[e.jsx("p",{className:"font-semibold text-xs text-base-content/50 uppercase tracking-wider",children:"Configuración de Rollo"}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Tamaño de etiqueta"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:$,onChange:t=>P(t.target.value),children:[e.jsx("option",{value:"50x25",children:"50 x 25 mm (Estándar)"}),e.jsx("option",{value:"40x30",children:"40 x 30 mm"}),e.jsx("option",{value:"60x40",children:"60 x 40 mm"}),e.jsx("option",{value:"80x50",children:"80 x 50 mm"}),e.jsx("option",{value:"personalizado",children:"Personalizado…"})]})]}),$==="personalizado"&&e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Ancho (mm)"}),e.jsx("input",{type:"number",min:20,max:150,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:T,onChange:t=>H(Math.max(20,Number(t.target.value)))})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Alto (mm)"}),e.jsx("input",{type:"number",min:15,max:100,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:D,onChange:t=>X(Math.max(15,Number(t.target.value)))})]})]}),e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer mt-1 select-none",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-xs checkbox-primary rounded",checked:A,onChange:t=>q(t.target.checked)}),e.jsx("span",{className:"text-xs text-base-content/85",children:"Mostrar contorno de etiqueta"})]})]}):e.jsxs("div",{className:"space-y-3",children:[e.jsx("p",{className:"font-semibold text-xs text-base-content/50 uppercase tracking-wider",children:"Configuración de Hoja"}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Tamaño de papel"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:k,onChange:t=>Q(t.target.value),children:[e.jsx("option",{value:"carta",children:"Carta / Letter"}),e.jsx("option",{value:"oficio",children:"Oficio (216 x 330 mm)"}),e.jsx("option",{value:"a4",children:"A4"})]})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Distribución (Grilla)"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:b,onChange:t=>{const n=t.target.value;B(n);const r=n==="3x10"||n==="3x8"?3:n==="4x10"?4:E,se=n==="3x10"?10:n==="3x8"?8:n==="4x10"?10:p;M(W=>Math.min(r*se,W))},children:[e.jsx("option",{value:"3x10",children:"3 x 10 (30 etiq. Avery)"}),e.jsx("option",{value:"3x8",children:"3 x 8 (24 etiq. Avery)"}),e.jsx("option",{value:"4x10",children:"4 x 10 (40 etiq.)"}),e.jsx("option",{value:"personalizado",children:"Personalizado…"})]})]})]}),b==="personalizado"&&e.jsxs("div",{className:"grid grid-cols-2 gap-2 bg-base-200/50 p-2 rounded-lg",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Columnas"}),e.jsx("input",{type:"number",min:1,max:10,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:E,onChange:t=>{const n=Math.max(1,Number(t.target.value));G(n),M(r=>Math.min(n*O,r))}})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Filas"}),e.jsx("input",{type:"number",min:1,max:20,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:p,onChange:t=>{const n=Math.max(1,Number(t.target.value));L(n),M(r=>Math.min(U*n,r))}})]})]}),e.jsxs("div",{className:"grid grid-cols-2 gap-2 items-end",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",title:"Omitir las primeras N etiquetas si ya fueron usadas",children:"📍 Iniciar en posición"}),e.jsx("input",{type:"number",min:1,max:Y,className:"input input-sm input-bordered w-full text-xs rounded-lg font-semibold text-center",value:R,onChange:t=>M(Math.min(Y,Math.max(1,Number(t.target.value))))})]}),e.jsx("div",{className:"pb-1",children:e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer select-none",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-xs checkbox-primary rounded",checked:A,onChange:t=>q(t.target.checked)}),e.jsx("span",{className:"text-xs text-base-content/85",children:"Líneas guía de corte"})]})})]}),e.jsxs("div",{className:"border-t border-base-200 pt-2",children:[e.jsxs("button",{type:"button",onClick:()=>s(!I),className:"flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer",children:[e.jsx(he,{className:"h-3 w-3"}),I?"Ocultar márgenes avanzados":"Configurar márgenes avanzados (mm)"]}),I&&e.jsxs("div",{className:"grid grid-cols-4 gap-1.5 mt-2 bg-base-200/40 p-2 rounded-lg text-[10px]",children:[e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Marg. Vert."}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:d,onChange:t=>f(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Marg. Horiz."}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:C,onChange:t=>v(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Espacio X"}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:j,onChange:t=>F(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Espacio Y"}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:_,onChange:t=>S(Number(t.target.value))})]})]})]})]})}),N==="hoja"&&e.jsxs("div",{className:"border border-base-200 rounded-xl p-3 bg-base-50 flex flex-col items-center shadow-inner",children:[e.jsxs("p",{className:"text-xs font-bold mb-2 text-base-content/60 uppercase tracking-wider",children:["Vista previa: Primera Hoja (",U,"x",O,")"]}),e.jsx("div",{className:"bg-white border border-base-300 shadow-md rounded overflow-hidden relative",style:{width:"180px",aspectRatio:`${te} / ${ae}`,padding:`${d/ae*180}px ${C/te*180}px`,display:"grid",gridTemplateColumns:`repeat(${U}, 1fr)`,gridTemplateRows:`repeat(${O}, 1fr)`,gap:`${_/ae*180}px ${j/te*180}px`,boxSizing:"border-box"},children:V.map((t,n)=>{let r={width:"100%",height:"100%",boxSizing:"border-box",borderRadius:"1px",display:"flex",alignItems:"center",justifyContent:"center"};return t==="skipped"?r={...r,background:"repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 3px, #e5e7eb 3px, #e5e7eb 6px)",border:"0.5px solid #d1d5db"}:t==="printed"?r={...r,backgroundColor:"rgba(59, 130, 246, 0.15)",border:"0.5px solid rgba(59, 130, 246, 0.5)"}:r={...r,backgroundColor:"#fff",border:"0.5px dashed #e5e7eb"},e.jsx("div",{style:r,title:`Posición ${n+1}: ${t==="skipped"?"Usada/Omitida":t==="printed"?"Etiqueta":"Vacía"}`,children:t==="printed"&&e.jsx("span",{className:"text-[8px] scale-75 leading-none opacity-80",children:"🏷️"})},n)})}),e.jsxs("p",{className:"text-[10px] text-base-content/50 mt-2 font-medium",children:["Se"," ",le===1?"usará 1 hoja":`usarán ${le} hojas`," ","en total. (",ee," etiquetas)."]})]}),e.jsxs("div",{className:"bg-base-200/50 rounded-xl p-3 text-xs space-y-1.5 border border-base-200",children:[e.jsx("p",{className:"font-semibold text-base-content/80 mb-2",children:"🏷️ Etiquetas a imprimir:"}),e.jsx("div",{className:"max-h-48 overflow-y-auto divide-y divide-base-200/80 pr-1",children:l.map((t,n)=>e.jsxs("div",{className:"flex items-center gap-2 py-1.5",children:[e.jsxs("div",{className:"min-w-0 flex-1",children:[e.jsx("p",{className:"truncate font-medium text-base-content/80",children:t.producto_nombre}),e.jsxs("p",{className:"font-mono text-[10px] text-base-content/50 truncate",children:["Lote: ",t.numero_lote]})]}),e.jsxs("div",{className:"flex items-center gap-1 flex-shrink-0",children:[e.jsx("button",{type:"button",className:"btn btn-xs btn-circle btn-ghost","aria-label":"Quitar una etiqueta",onClick:()=>K(n,a(n)-1),children:"−"}),e.jsx("input",{type:"number",min:1,max:999,className:"input input-xs input-bordered w-14 text-center font-semibold",value:a(n),onChange:r=>K(n,Number(r.target.value))}),e.jsx("button",{type:"button",className:"btn btn-xs btn-circle btn-ghost","aria-label":"Agregar una etiqueta",onClick:()=>K(n,a(n)+1),children:"+"})]})]},`${t.lote_id}-${n}`))})]}),e.jsxs(ve,{className:"w-full btn-md text-sm font-bold shadow-lg",onClick:pe,disabled:w,children:[e.jsx(ke,{className:"h-4 w-4 mr-2"}),w?"Generando etiquetas…":e.jsxs("span",{children:["Imprimir"," ",e.jsx(ie,{qty:m,unidad:"etiqueta",pluralUnidad:"etiquetas"})]})]})]})}if(!x||x.length===0)return null;const J=x.flatMap(a=>a.lotes.filter(m=>ne(m)&&a.area_destino_id).map(m=>({...m,detalleId:a.id,producto_nombre:a.producto_nombre,area_destino_nombre:a.area_destino_nombre}))),xe=x.flatMap(a=>a.lotes.filter(m=>!ne(m)||!a.area_destino_id).map(m=>({...m,detalleId:a.id,producto_nombre:a.producto_nombre})));if(J.length===0)return null;const oe=J.filter(a=>a.incluir_etiqueta).reduce((a,m)=>a+m.cantidad_etiquetas,0);return e.jsxs("div",{className:"card bg-base-100 border border-dashed p-4",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("p",{className:"font-semibold text-sm",children:"🏷️ Configurar etiquetas"}),e.jsx("button",{className:"btn btn-ghost btn-xs btn-circle",onClick:()=>g(a=>!a),"aria-label":u?"Expandir":"Colapsar",children:u?e.jsx(ye,{className:"h-4 w-4"}):e.jsx(Ne,{className:"h-4 w-4"})})]}),!u&&e.jsxs("div",{className:"space-y-2",children:[J.map(a=>e.jsxs("div",{className:"flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200 text-sm",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-sm checkbox-primary",checked:a.incluir_etiqueta,onChange:m=>o==null?void 0:o(a.detalleId,a.id,m.target.checked)}),e.jsx("span",{className:"flex-1 truncate text-xs",children:a.producto_nombre}),e.jsxs("span",{className:"text-xs opacity-50 font-mono truncate",children:[a.codigo_lote,a.fecha_vencimiento?` · ${a.fecha_vencimiento}`:"",a.area_destino_nombre?` · ${a.area_destino_nombre}`:""]}),a.incluir_etiqueta&&e.jsx("input",{type:"number",min:1,max:99,className:"input input-xs input-bordered w-14 text-center",value:a.cantidad_etiquetas,onChange:m=>y==null?void 0:y(a.detalleId,a.id,Math.max(1,Number(m.target.value)))})]},a.id)),xe.map(a=>e.jsxs("div",{className:"opacity-40 cursor-not-allowed flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-sm",disabled:!0}),e.jsx("span",{className:"flex-1 text-sm",children:a.producto_nombre}),e.jsx("span",{className:"badge badge-xs badge-ghost",children:"Datos incompletos"})]},a.id))]}),oe>0&&e.jsxs("p",{className:"text-xs opacity-50 mt-2 text-right",children:[e.jsx(ie,{qty:oe,unidad:"etiqueta",pluralUnidad:"etiquetas"})," ","se imprimirán al confirmar"]})]})}export{Te as L,ke as P,Me as Q,Pe as i};
