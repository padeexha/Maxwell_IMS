export const seed = {
  products: [
    {id:'p1',name:'Samsung 55-inch Crystal UHD TV',brand:'Samsung',sku:'SAM-TV-55-CU8000',category:'Electronics',model:'CU8000',reorderLevel:2,unitValue:185000},
    {id:'p2',name:'Singer 300L Double Door Refrigerator',brand:'Singer',sku:'SIN-RF-300-DD',category:'Appliances',model:'SRF-300',reorderLevel:2,unitValue:145000},
    {id:'p3',name:'Modern 3-Seater Sofa',brand:'Maxwell Home',sku:'MXL-SOF-3S-GRY',category:'Furniture',model:'M3S-GRY',reorderLevel:1,unitValue:85000},
    {id:'p4',name:'Panasonic Microwave Oven 25L',brand:'Panasonic',sku:'PAN-MW-25L',category:'Appliances',model:'NN-ST34',reorderLevel:2,unitValue:32000}
  ],
  units: [
    {id:'u1',code:'MSM-8F4A7C',productId:'p1',serial:'SAM-CU8-091428',status:'Available',receivedAt:'2026-10-24'},
    {id:'u2',code:'MSM-9K2D5H',productId:'p1',serial:'SAM-CU8-091429',status:'Available',receivedAt:'2026-10-24'},
    {id:'u3',code:'MSM-4Q7X1B',productId:'p2',serial:'SNG-300-00481',status:'Available',receivedAt:'2026-10-22'},
    {id:'u4',code:'MSM-6L9P3R',productId:'p2',serial:'SNG-300-00482',status:'Sold',receivedAt:'2026-10-21',soldAt:'2026-10-27'},
    {id:'u5',code:'MSM-2T8M5V',productId:'p3',serial:'',status:'Available',receivedAt:'2026-10-20'},
    {id:'u6',code:'MSM-7W3N9C',productId:'p3',serial:'',status:'Repair',receivedAt:'2026-10-19'},
    {id:'u7',code:'MSM-3J5R8K',productId:'p4',serial:'PAN-25L-10923',status:'Available',receivedAt:'2026-10-26'},
    {id:'u8',code:'MSM-1C6F4Z',productId:'p4',serial:'PAN-25L-10924',status:'Available',receivedAt:'2026-10-18',returnedAt:'2026-10-27'}
  ],
  activities: [
    {id:'a1',type:'sale',unitCode:'MSM-6L9P3R',text:'Marked as sold',by:'Kavindi Perera',at:'2026-10-28T09:45:00'},
    {id:'a2',type:'return',unitCode:'MSM-1C6F4Z',text:'Returned to stock',by:'Nimal Abeysekera',at:'2026-10-27T15:22:00'},
    {id:'a3',type:'add',unitCode:'MSM-3J5R8K',text:'Received into stock',by:'Nimal Abeysekera',at:'2026-10-26T11:10:00'},
    {id:'a4',type:'add',unitCode:'MSM-9K2D5H',text:'Received into stock',by:'Nimal Abeysekera',at:'2026-10-24T10:03:00'}
  ],
  users:[{name:'Nimal Abeysekera',initials:'NA',role:'Administrator',email:'nimal@maxwell.lk'},{name:'Kavindi Perera',initials:'KP',role:'Worker',email:'kavindi@maxwell.lk'},{name:'Dilan Fernando',initials:'DF',role:'Manager',email:'dilan@maxwell.lk'}]
};
