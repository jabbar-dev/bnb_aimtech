/*  backend/routes/guestHouse.js  */
const router         = require('express').Router();
const { protect }    = require('../middleware/auth');
const { allowRoles } = require('../middleware/roles');
const GuestHouse     = require('../models/GuestHouse');

const authorised = allowRoles('vc-office','superadmin','guest-house');

/* CREATE booking ------------------------------------------------ */
router.post('/', protect, authorised, async (req,res)=>{
  try{
    const { name, cnic, roomNo, bookingDate, organization='-', guestType='Outsider',
            purpose='-', vehicleNo='-' } = req.body;
    if(!name||!cnic||!roomNo||!bookingDate)
      return res.status(400).json({msg:'name, cnic, roomNo, bookingDate required'});
    if(!/^\d{13}$/.test(cnic)) return res.status(400).json({msg:'CNIC 13 digits'});

    const bDate=new Date(bookingDate);
    const start=new Date(bDate); start.setHours(0,0,0,0);
    const end  =new Date(bDate); end.setHours(23,59,59,999);

    const clash = await GuestHouse.findOne({
      roomNo, bookingDate:{$gte:start,$lte:end},
      status:{$in:['reserved','checked-in']}
    });
    if(clash) return res.status(409).json({msg:`Room ${roomNo} already booked`});

    const g = await GuestHouse.create({
      name,cnic,roomNo,bookingDate:bDate,organization,guestType,
      purpose,vehicleNo,registeredBy:req.user.id
    });
    res.status(201).json(g);
  }catch(err){ console.error(err); res.status(500).json({msg:'Server error'}); }
});

/* LIST ---------------------------------------------------------- */
router.get('/', protect, authorised, async (req,res)=>{
  const list = await GuestHouse.find().sort('-createdAt');
  res.json(list);
});

/* CASH pending total ------------------------------------------- */
router.get('/cash-pending', protect, authorised, async (req,res)=>{
  const agg = await GuestHouse.aggregate([
    { $match:{ paymentMethod:'cash', deposited:false } },
    { $group:{ _id:null, total:{ $sum:'$billAmount' } } }
  ]);
  res.json({ pending: agg[0]?.total || 0 });
});

// PUT /api/guest-house/:id/pay
router.put('/:id/pay', protect, authorised, async (req,res)=>{
  const { method, txId } = req.body;
  if(!['cash','account'].includes(method)) return res.status(400).json({msg:'bad method'});
  const g = await GuestHouse.findById(req.params.id);
  if(!g) return res.status(404).json({msg:'not found'});
  if(g.paymentMethod) return res.status(409).json({msg:'already paid'});

  g.paymentMethod = method;
  if(method==='account') g.txId = txId;
  await g.save();
  res.json(g);
});


/* UPDATE status / payment -------------------------------------- */
router.put('/:id', protect, authorised, async (req,res)=>{
  try{
    const { status, stayDays, billAmount, paymentMethod, txId } = req.body;
    const g = await GuestHouse.findById(req.params.id);
    if(!g) return res.status(404).json({msg:'Not found'});

    if(status){
      if(!['reserved','checked-in','checked-out','cancelled'].includes(status))
        return res.status(400).json({msg:'Bad status'});
      if(status==='checked-in' && !g.checkInAt)  g.checkInAt = Date.now();
      if(status==='checked-out'&& !g.checkOutAt){
        g.checkOutAt = Date.now();
        if(stayDays)   g.stayDays   = stayDays;
        if(billAmount) g.billAmount = billAmount;
      }
      g.status = status;
    }

    if(paymentMethod){
      if(!['cash','account'].includes(paymentMethod))
        return res.status(400).json({msg:'paymentMethod cash|account'});
      g.paymentMethod = paymentMethod;
      if(paymentMethod==='account') g.txId = txId;
    }

    await g.save({validateBeforeSave:false});
    res.json(g);
  }catch(err){ console.error(err); res.status(500).json({msg:'Server error'}); }
});

module.exports = router;
