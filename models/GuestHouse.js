/*  backend/models/GuestHouse.js  */
const mongoose = require('mongoose');

/**
 * Guest-House visitors collection
 * ───────────────────────────────
 *  ─ identity & booking info
 *  ─ status flow  (reserved → checked-in → checked-out → cancelled)
 *  ─ billing + payment metadata
 */
const GuestHouseSchema = new mongoose.Schema(
  {
    /* identity -------------------------------------------------------- */
    name        : { type:String, required:true },
    cnic        : { type:String, match:/^\d{13}$/, required:true },

    organization: { type:String, default:'-' },
    guestType   : { type:String, enum:['BNB University','Outsider'], default:'Outsider' },

    /* booking --------------------------------------------------------- */
    roomNo      : { type:String, required:true },
    bookingDate : { type:Date,   required:true },
    purpose     : { type:String, default:'-' },
    vehicleNo   : { type:String, default:'-' },

    registeredBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },

    /* lifecycle ------------------------------------------------------- */
    status      : { type:String,
                    enum:['reserved','checked-in','checked-out','cancelled'],
                    default:'reserved' },
    checkInAt   : { type:Date },
    checkOutAt  : { type:Date },
    stayDays    : { type:Number, default:0 },
    billAmount  : { type:Number, default:0 },

    /* payment --------------------------------------------------------- */
    paymentMethod : { type:String, enum:['cash','account',null], default:null },
    txId          : { type:String },
    cashChallanId : { type:mongoose.Schema.Types.ObjectId, ref:'CashChallan' },
    deposited     : { type:Boolean, default:false }     // true once cash goes to bank
  },
  { timestamps:true }                                     // createdAt / updatedAt
);

/* -------------------------------------------------------------------- */
/* Guard against “OverwriteModelError” when the file is re-required.    */
module.exports = mongoose.models.GuestHouse
               ?? mongoose.model('GuestHouse', GuestHouseSchema);
