if (process.env.NODE_ENV != "production") {
  require('dotenv').config();
}

const express = require("express");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const routes = require("./routes/samples.js");
const ExpressError = require("./utils/ExpressError.js");
const session = require('express-session');
const flash = require("connect-flash");

const passport = require("passport");
const LocalStrategy = require("passport-local");
const user = require("./models/user.js")

const app = express();
const path = require("path");
const PORT = 8080;

const multer = require("multer")
const upload = multer({});

app.engine('ejs', ejsMate);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: true }));

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MongoDB_URL);
    console.log("DataBase Connected");
  } catch (err) {
    console.log(err);
  }
}

const sessionOptions = {
  secret: "tulipLotusParis",
  resave: false,
  saveUninitialized: true,
  cookie: {
    expires: Date.now() + 1000 * 60 * 60 * 5 * 24,
    maxAge: 1000 * 60 * 60 * 5 * 24,  //5days
    httpOnly: true,
  }
}

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());


app.use((req,res,next)=>{
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  res.locals.currUser = req.user;
  next();
})

// passport.use(new localStretegy(User.authenticate()));
passport.use(new LocalStrategy(user.authenticate()));
passport.serializeUser(user.serializeUser());
passport.deserializeUser(user.deserializeUser());



app.use("/", routes);

app.listen(PORT, async (req, res) => {
  console.log(`Listning to port ${PORT}`);
  connectDb();
})


// router.post("/purchase/:id", isLoggedIn,
  
//   upload.fields([
//     { name: "images", maxCount: 5 },        // multiple images
//     { name: "paymentImage", maxCount: 1 }   // single image
//   ]), 
  
//   wrapAsync(async (req, res) => {
  
//   let url = req.file.path;
//   let filename = req.file.filename;
  
//   const { id } = req.params;
//   const buyinfo = req.body.purchase;
//   const specialMsgarr = [buyinfo.specialMsg];

//   // const imageUrlarr = [buyinfo.imageUrl]
//   const newPurchase = new purchasedWeb({
//     webId: id,
//     sender: buyinfo.sender,
//     receiver: buyinfo.receiver,
//     price: buyinfo.price,
//     images: [{url,filename}],
//     paymentProofUrl: buyinfo.paymentProofUrl,
//     specialMsg: specialMsgarr,
//     author: req.user._id,
//     webName: buyinfo.webName ,
//   })

//   try {
//     const save = await newPurchase.save();
//     console.log("Purchase success");
//     req.flash("success", "Purchase Success");
//     res.redirect("/");
//   } catch (err) {
//     console.log(err);
//     res.redirect("/");
//   }
// }))







// Save Purchased 
// router.post("/purchase/:id", isLoggedIn,upload.single("[buyinfo.imageUrl]"), wrapAsync(async (req, res) => {
  
//   let url = req.file.path;
//   let filename = req.file.filename;
  
//   const { id } = req.params;
//   const buyinfo = req.body.purchase;
//   const specialMsgarr = [buyinfo.specialMsg];

//   const imageUrlarr = [buyinfo.imageUrl]
//   const newPurchase = new purchasedWeb({
//     webId: id,
//     sender: buyinfo.sender,
//     receiver: buyinfo.receiver,
//     price: buyinfo.price,
//     imageUrl: {url,filename},
//     paymentProofUrl: buyinfo.paymentProofUrl,
//     specialMsg: specialMsgarr,
//     author: req.user._id,
//     webName: buyinfo.webName ,
//   })

//   try {
//     const save = await newPurchase.save();
//     console.log("Purchase success");
//     req.flash("success", "Purchase Success");
//     res.redirect("/");
//   } catch (err) {
//     console.log(err);
//     res.redirect("/");
//   }
// }))
