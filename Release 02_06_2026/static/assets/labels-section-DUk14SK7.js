import{b as le,j as e,z as ce,q as de}from"./index-Ds5xVYt1.js";import{g as me,r}from"./react-DS8arpni.js";import{C as ae}from"./cantidad-DETYTMoF.js";import{B as xe}from"./button-BCWlc-nP.js";import{r as pe}from"./scanner-Dh8vzQln.js";import{C as be}from"./chevron-down-BRvX6bK8.js";import{C as ue}from"./chevron-up-Cno0tUpO.js";/**
 * @license lucide-react v0.577.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const he=[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]],ge=le("printer",he);var fe=pe();const ve=me(fe);async function je(m,o={formato:"rollo",rolloTamano:"50x25",mostrarBordes:!0}){var C,L,_;const j=o.formato==="rollo";let i=50,l=25,w=50,f=25,b=1,v=1,y=0,z=0,k=0,P=0,T=0;if(j){const a=o.rolloTamano||"50x25";a==="50x25"?(i=50,l=25):a==="40x30"?(i=40,l=30):a==="60x40"?(i=60,l=40):a==="80x50"?(i=80,l=50):(i=o.rolloAnchoCustom||50,l=o.rolloAltoCustom||25),w=i,f=l}else{const a=o.hojaTamano||"carta";a==="carta"?(i=215.9,l=279.4):a==="oficio"?(i=216,l=330):a==="a4"&&(i=210,l=297);const x=o.hojaDiseno||"3x10";x==="3x10"?(b=3,v=10):x==="3x8"?(b=3,v=8):x==="4x10"?(b=4,v=10):(b=o.hojaColumnas||3,v=o.hojaFilas||10),y=o.margenX!==void 0?o.margenX:10,z=o.margenY!==void 0?o.margenY:10,k=o.espacioX!==void 0?o.espacioX:2,P=o.espacioY!==void 0?o.espacioY:2,T=Math.max(0,(o.posicionInicial||1)-1),w=(i-2*y-k*(b-1))/b,f=(l-2*z-P*(v-1))/v}const I=[];for(const a of m){const x=await ve.toDataURL(a.codigo_interno,{width:128,margin:1,errorCorrectionLevel:"M"}),h=a.fecha_vencimiento?new Date(a.fecha_vencimiento+"T00:00:00").toLocaleDateString("es-CL",{day:"2-digit",month:"2-digit",year:"2-digit"}):"—",$=a.presentacion_nombre||"",g=w>60?38:28,M=a.producto_nombre.length>g?a.producto_nombre.slice(0,g-2)+"…":a.producto_nombre,q=`
      <div class="label-cell">
        <img class="qr" src="${x}" alt="QR ${a.codigo_interno}" />
        <div class="info">
          <div class="nombre">${M}</div>
          <div class="sub">${$?$+" · ":""}${a.area_nombre}</div>
          <div class="lote">Lote: ${a.numero_lote}</div>
          <div class="vence">Vence: ${h}</div>
        </div>
      </div>`;for(let S=0;S<a.cantidad_etiquetas;S++)I.push(q)}let R="";if(j)R=I.map(a=>a).join(`
`);else{const a=[],x=b*v;let h=0,$=!0;for(;h<I.length;){const g=[];let M=0;if($){M=T;for(let A=0;A<M;A++)g.push('<div class="label-empty"></div>');$=!1}const q=x-M,S=I.slice(h,h+q);for(g.push(...S),h+=S.length;g.length<x;)g.push('<div class="label-empty"></div>');a.push(`
        <div class="page">
          ${g.join(`
`)}
        </div>
      `)}R=a.join(`
`)}const F=Math.min(w*.35,f*.72),N=Math.min(12,Math.max(5.5,f*.22)),W=Math.min(10,Math.max(4.5,f*.18)),u=Math.min(11,Math.max(5,f*.2)),X=o.mostrarBordes??!!j,V=`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
${`
    @page {
      size: ${i}mm ${l}mm;
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
      height: ${f}mm;
      display: flex;
      align-items: center;
      gap: 2mm;
      padding: 1.5mm;
      overflow: hidden;
      background: white;
      box-sizing: border-box;
      ${j?"page-break-after: always;":""}
      ${X?"border: 0.25mm solid #ccc;":"border: none;"}
    }
    ${j?".label-cell:last-child { page-break-after: avoid; }":""}

    /* Hoja */
    .page {
      width: ${i}mm;
      height: ${l}mm;
      padding: ${z}mm ${y}mm;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: repeat(${b}, 1fr);
      grid-template-rows: repeat(${v}, 1fr);
      gap: ${P}mm ${k}mm;
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
      ${X?"border: 0.15mm dashed #ddd;":"border: none;"}
    }
    
    /* Elementos Internos */
    .qr {
      width: ${F}mm;
      height: ${F}mm;
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
      font-size: ${N}pt;
      font-weight: bold;
      line-height: 1.25;
      margin-bottom: 0.4mm;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .sub {
      font-size: ${W}pt;
      color: #555;
      margin-bottom: 0.4mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lote {
      font-size: ${u}pt;
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .vence {
      font-size: ${u}pt;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `}
</style>
</head>
<body>
${R}
</body>
</html>`,d=document.createElement("iframe");d.style.cssText="position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0",document.body.appendChild(d);const D=d.contentDocument||((C=d.contentWindow)==null?void 0:C.document);if(!D){document.body.removeChild(d);return}D.open(),D.write(V),D.close();const H=d.contentDocument||((L=d.contentWindow)==null?void 0:L.document);if(H){const a=Array.from(H.querySelectorAll("img"));await Promise.all(a.map(x=>x.complete?Promise.resolve():new Promise(h=>x.addEventListener("load",()=>h(),{once:!0}))))}(_=d.contentWindow)==null||_.print(),setTimeout(()=>document.body.removeChild(d),2e3)}function ee(m){return!!(m.codigo_lote&&m.fecha_vencimiento)}function Me(m){return!!(m.area_destino_id&&m.lotes.length>0&&m.lotes.every(ee))}function qe({detalles:m,onToggleEtiqueta:o,onCantidadEtiqueta:j,lotesConfirmados:i,onAfterPrint:l}){const[w,f]=r.useState(!1),[b,v]=r.useState(!1),[y,z]=r.useState("rollo"),[k,P]=r.useState("50x25"),[T,I]=r.useState(50),[R,F]=r.useState(25),[N,W]=r.useState("carta"),[u,X]=r.useState("3x10"),[Y,V]=r.useState(3),[d,D]=r.useState(10),[H,C]=r.useState(1),[L,_]=r.useState(!0),[a,x]=r.useState(!1),[h,$]=r.useState(10),[g,M]=r.useState(10),[q,S]=r.useState(2),[A,oe]=r.useState(2);if(i){const s=i.reduce((t,n)=>t+n.cantidad_etiquetas,0),c=async()=>{f(!0);try{await je(i,{formato:y,rolloTamano:k,rolloAnchoCustom:T,rolloAltoCustom:R,hojaTamano:N,hojaDiseno:u,hojaColumnas:Y,hojaFilas:d,posicionInicial:H,mostrarBordes:L,margenY:h,margenX:g,espacioX:q,espacioY:A}),l==null||l()}catch{de.error("Error al generar etiquetas")}finally{f(!1)}},B=u==="3x10"||u==="3x8"?3:u==="4x10"?4:Y,U=u==="3x10"?10:u==="3x8"?8:u==="4x10"?10:d,E=B*U,G=Math.min(E-1,Math.max(0,H-1)),J=s,O=[];for(let t=0;t<E;t++)t<G?O.push("skipped"):t<G+J?O.push("printed"):O.push("empty");const K=N==="carta"?215.9:N==="oficio"?216:210,Z=N==="carta"?279.4:N==="oficio"?330:297,se=Math.ceil((J+G)/E);return e.jsxs("div",{className:"space-y-4",children:[e.jsxs("div",{className:"grid grid-cols-2 gap-2 bg-base-200 p-1 rounded-xl",children:[e.jsx("button",{type:"button",className:`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all ${y==="rollo"?"bg-primary text-primary-content hover:bg-primary/95":"bg-transparent text-base-content/60 hover:bg-base-300"}`,onClick:()=>{z("rollo"),_(!0)},children:"📟 Imp. Etiquetas (Rollo)"}),e.jsx("button",{type:"button",className:`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all ${y==="hoja"?"bg-primary text-primary-content hover:bg-primary/95":"bg-transparent text-base-content/60 hover:bg-base-300"}`,onClick:()=>{z("hoja"),_(!1)},children:"📄 Imp. Común (Hojas)"})]}),e.jsx("div",{className:"card bg-base-100 border border-base-200 p-4 space-y-4 shadow-sm",children:y==="rollo"?e.jsxs("div",{className:"space-y-3",children:[e.jsx("p",{className:"font-semibold text-xs text-base-content/50 uppercase tracking-wider",children:"Configuración de Rollo"}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Tamaño de etiqueta"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:k,onChange:t=>P(t.target.value),children:[e.jsx("option",{value:"50x25",children:"50 x 25 mm (Estándar)"}),e.jsx("option",{value:"40x30",children:"40 x 30 mm"}),e.jsx("option",{value:"60x40",children:"60 x 40 mm"}),e.jsx("option",{value:"80x50",children:"80 x 50 mm"}),e.jsx("option",{value:"personalizado",children:"Personalizado…"})]})]}),k==="personalizado"&&e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Ancho (mm)"}),e.jsx("input",{type:"number",min:20,max:150,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:T,onChange:t=>I(Math.max(20,Number(t.target.value)))})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Alto (mm)"}),e.jsx("input",{type:"number",min:15,max:100,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:R,onChange:t=>F(Math.max(15,Number(t.target.value)))})]})]}),e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer mt-1 select-none",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-xs checkbox-primary rounded",checked:L,onChange:t=>_(t.target.checked)}),e.jsx("span",{className:"text-xs text-base-content/85",children:"Mostrar contorno de etiqueta"})]})]}):e.jsxs("div",{className:"space-y-3",children:[e.jsx("p",{className:"font-semibold text-xs text-base-content/50 uppercase tracking-wider",children:"Configuración de Hoja"}),e.jsxs("div",{className:"grid grid-cols-2 gap-2",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Tamaño de papel"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:N,onChange:t=>W(t.target.value),children:[e.jsx("option",{value:"carta",children:"Carta / Letter"}),e.jsx("option",{value:"oficio",children:"Oficio (216 x 330 mm)"}),e.jsx("option",{value:"a4",children:"A4"})]})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",children:"Distribución (Grilla)"}),e.jsxs("select",{className:"select select-sm select-bordered w-full text-xs rounded-lg",value:u,onChange:t=>{const n=t.target.value;X(n);const p=n==="3x10"||n==="3x8"?3:n==="4x10"?4:Y,ie=n==="3x10"?10:n==="3x8"?8:n==="4x10"?10:d;C(re=>Math.min(p*ie,re))},children:[e.jsx("option",{value:"3x10",children:"3 x 10 (30 etiq. Avery)"}),e.jsx("option",{value:"3x8",children:"3 x 8 (24 etiq. Avery)"}),e.jsx("option",{value:"4x10",children:"4 x 10 (40 etiq.)"}),e.jsx("option",{value:"personalizado",children:"Personalizado…"})]})]})]}),u==="personalizado"&&e.jsxs("div",{className:"grid grid-cols-2 gap-2 bg-base-200/50 p-2 rounded-lg",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Columnas"}),e.jsx("input",{type:"number",min:1,max:10,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:Y,onChange:t=>{const n=Math.max(1,Number(t.target.value));V(n),C(p=>Math.min(n*U,p))}})]}),e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block",children:"Filas"}),e.jsx("input",{type:"number",min:1,max:20,className:"input input-sm input-bordered w-full text-xs rounded-lg",value:d,onChange:t=>{const n=Math.max(1,Number(t.target.value));D(n),C(p=>Math.min(B*n,p))}})]})]}),e.jsxs("div",{className:"grid grid-cols-2 gap-2 items-end",children:[e.jsxs("div",{children:[e.jsx("label",{className:"label-text font-semibold text-xs text-base-content/80 mb-1 block",title:"Omitir las primeras N etiquetas si ya fueron usadas",children:"📍 Iniciar en posición"}),e.jsx("input",{type:"number",min:1,max:E,className:"input input-sm input-bordered w-full text-xs rounded-lg font-semibold text-center",value:H,onChange:t=>C(Math.min(E,Math.max(1,Number(t.target.value))))})]}),e.jsx("div",{className:"pb-1",children:e.jsxs("label",{className:"flex items-center gap-2 cursor-pointer select-none",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-xs checkbox-primary rounded",checked:L,onChange:t=>_(t.target.checked)}),e.jsx("span",{className:"text-xs text-base-content/85",children:"Líneas guía de corte"})]})})]}),e.jsxs("div",{className:"border-t border-base-200 pt-2",children:[e.jsxs("button",{type:"button",onClick:()=>x(!a),className:"flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer",children:[e.jsx(ce,{className:"h-3 w-3"}),a?"Ocultar márgenes avanzados":"Configurar márgenes avanzados (mm)"]}),a&&e.jsxs("div",{className:"grid grid-cols-4 gap-1.5 mt-2 bg-base-200/40 p-2 rounded-lg text-[10px]",children:[e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Marg. Vert."}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:h,onChange:t=>$(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Marg. Horiz."}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:g,onChange:t=>M(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Espacio X"}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:q,onChange:t=>S(Number(t.target.value))})]}),e.jsxs("div",{children:[e.jsx("span",{className:"opacity-75 block mb-0.5",children:"Espacio Y"}),e.jsx("input",{type:"number",step:.5,className:"input input-xs input-bordered w-full text-center text-base-content",value:A,onChange:t=>oe(Number(t.target.value))})]})]})]})]})}),y==="hoja"&&e.jsxs("div",{className:"border border-base-200 rounded-xl p-3 bg-base-50 flex flex-col items-center shadow-inner",children:[e.jsxs("p",{className:"text-[11px] font-bold mb-2 text-base-content/60 uppercase tracking-wider",children:["Vista previa: Primera Hoja (",B,"x",U,")"]}),e.jsx("div",{className:"bg-white border border-base-300 shadow-md rounded overflow-hidden relative",style:{width:"180px",aspectRatio:`${K} / ${Z}`,padding:`${h/Z*180}px ${g/K*180}px`,display:"grid",gridTemplateColumns:`repeat(${B}, 1fr)`,gridTemplateRows:`repeat(${U}, 1fr)`,gap:`${A/Z*180}px ${q/K*180}px`,boxSizing:"border-box"},children:O.map((t,n)=>{let p={width:"100%",height:"100%",boxSizing:"border-box",borderRadius:"1px",display:"flex",alignItems:"center",justifyContent:"center"};return t==="skipped"?p={...p,background:"repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 3px, #e5e7eb 3px, #e5e7eb 6px)",border:"0.5px solid #d1d5db"}:t==="printed"?p={...p,backgroundColor:"rgba(59, 130, 246, 0.15)",border:"0.5px solid rgba(59, 130, 246, 0.5)"}:p={...p,backgroundColor:"#fff",border:"0.5px dashed #e5e7eb"},e.jsx("div",{style:p,title:`Posición ${n+1}: ${t==="skipped"?"Usada/Omitida":t==="printed"?"Etiqueta":"Vacía"}`,children:t==="printed"&&e.jsx("span",{className:"text-[8px] scale-75 leading-none opacity-80",children:"🏷️"})},n)})}),e.jsxs("p",{className:"text-[10px] text-base-content/50 mt-2 font-medium",children:["Se ",se===1?"usará 1 hoja":`usarán ${se} hojas`," en total. (",J," etiquetas)."]})]}),e.jsxs("div",{className:"bg-base-200/50 rounded-xl p-3 text-xs space-y-1.5 border border-base-200",children:[e.jsx("p",{className:"font-semibold text-base-content/80 mb-1",children:"🏷️ Resumen de etiquetas:"}),e.jsx("div",{className:"max-h-28 overflow-y-auto divide-y divide-base-200/80 pr-1",children:i.map(t=>e.jsxs("div",{className:"flex justify-between py-1 text-base-content/75 text-[11px]",children:[e.jsx("span",{className:"truncate pr-2 font-medium",children:t.producto_nombre}),e.jsxs("span",{className:"font-mono flex-shrink-0 text-base-content/60",children:["Lote: ",t.numero_lote," · ",e.jsx("strong",{className:"text-base-content font-bold",children:t.cantidad_etiquetas})]})]},t.lote_id))})]}),e.jsxs(xe,{className:"w-full btn-md text-sm font-bold shadow-lg",onClick:c,disabled:w,children:[e.jsx(ge,{className:"h-4 w-4 mr-2"}),w?"Generando etiquetas…":e.jsxs("span",{children:["Imprimir ",e.jsx(ae,{qty:s,unidad:"etiqueta",pluralUnidad:"etiquetas"})]})]})]})}if(!m||m.length===0)return null;const Q=m.flatMap(s=>s.lotes.filter(c=>ee(c)&&s.area_destino_id).map(c=>({...c,detalleId:s.id,producto_nombre:s.producto_nombre,area_destino_nombre:s.area_destino_nombre}))),ne=m.flatMap(s=>s.lotes.filter(c=>!ee(c)||!s.area_destino_id).map(c=>({...c,detalleId:s.id,producto_nombre:s.producto_nombre})));if(Q.length===0)return null;const te=Q.filter(s=>s.incluir_etiqueta).reduce((s,c)=>s+c.cantidad_etiquetas,0);return e.jsxs("div",{className:"card bg-base-100 border border-dashed p-4",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("p",{className:"font-semibold text-sm",children:"🏷️ Configurar etiquetas"}),e.jsx("button",{className:"btn btn-ghost btn-xs btn-circle",onClick:()=>v(s=>!s),"aria-label":b?"Expandir":"Colapsar",children:b?e.jsx(be,{className:"h-4 w-4"}):e.jsx(ue,{className:"h-4 w-4"})})]}),!b&&e.jsxs("div",{className:"space-y-2",children:[Q.map(s=>e.jsxs("div",{className:"flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200 text-sm",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-sm checkbox-primary",checked:s.incluir_etiqueta,onChange:c=>o==null?void 0:o(s.detalleId,s.id,c.target.checked)}),e.jsx("span",{className:"flex-1 truncate text-xs",children:s.producto_nombre}),e.jsxs("span",{className:"text-xs opacity-50 font-mono truncate",children:[s.codigo_lote,s.fecha_vencimiento?` · ${s.fecha_vencimiento}`:"",s.area_destino_nombre?` · ${s.area_destino_nombre}`:""]}),s.incluir_etiqueta&&e.jsx("input",{type:"number",min:1,max:99,className:"input input-xs input-bordered w-14 text-center",value:s.cantidad_etiquetas,onChange:c=>j==null?void 0:j(s.detalleId,s.id,Math.max(1,Number(c.target.value)))})]},s.id)),ne.map(s=>e.jsxs("div",{className:"opacity-40 cursor-not-allowed flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200",children:[e.jsx("input",{type:"checkbox",className:"checkbox checkbox-sm",disabled:!0}),e.jsx("span",{className:"flex-1 text-sm",children:s.producto_nombre}),e.jsx("span",{className:"badge badge-xs badge-ghost",children:"Datos incompletos"})]},s.id))]}),te>0&&e.jsxs("p",{className:"text-xs opacity-50 mt-2 text-right",children:[e.jsx(ae,{qty:te,unidad:"etiqueta",pluralUnidad:"etiquetas"})," se imprimirán al confirmar"]})]})}export{qe as L,ge as P,ve as Q,ee as a,Me as i};
