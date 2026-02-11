if (process.env.NODE_ENV != "production") {
  require('dotenv').config();
}

const express = require("express");
const mongoose = require("mongoose");
const ejsMate = require("ejs-mate");
const routes = require("./routes/samples.js");
const webRoutes = require("./routes/website.js");
const adminRoutes = require("./routes/admin.js");
const feedbackRouted = require("./routes/feedback.js");
const gameRoutes = require("./routes/game.js");

const session = require('express-session');
const flash = require("connect-flash");

const passport = require("passport");
const LocalStrategy = require("passport-local");
const user = require("./models/user.js");

const app = express();
const path = require("path");
const PORT = process.env.PORT || 8080;

const methodOverride = require("method-override");

const multer = require("multer")
const upload = multer({});

app.engine('ejs', ejsMate);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(methodOverride("_method"));

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
  secret: process.env.SESSION_SECRET,
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

app.use((req, res, next) => {
  res.locals.title = "VishLink – Create Personalized Wishing Websites";

  res.locals.description =
    "Create beautiful personalized birthday, anniversary and love wishing websites using VishLink.";

  res.locals.canonical =
    "https://wishlink-7j0a.onrender.com" + req.originalUrl;

  res.locals.robots = "index, follow";

  // Open Graph defaults
  res.locals.ogTitle = res.locals.title;
  res.locals.ogDescription = res.locals.description;
  res.locals.ogImage =
    "https://wishlink-7j0a.onrender.com/og-image.png";
  res.locals.ogUrl = res.locals.canonical;

  next();
});

// copy data from old database 
// const secondConn = mongoose.createConnection(process.env.MongoDB_URLS);
// const SecondUser = secondConn.model("purchasedWeb", PurchasedWeb.schema);

// app.get("/copy-users", async (req, res) => {
//   try {
//     const users = await PurchasedWeb.find({}).select("+hash +salt").lean();
//     await SecondUser.deleteMany({});
//     await SecondUser.insertMany(users);
//     console.log("done");
    
//     res.send("Copied successfully");
//   } catch (err) {
//     console.log(err);
    
//     res.send(err.message);
//   }
// });

// drop database 
// app.get("/drop-old-db", async (req, res) => {
//   if (req.query.confirm !== "YES") {
//     return res.send("Add ?confirm=YES to delete DB");
//   }

//   await mongoose.connection.dropDatabase();
//   res.send("Database dropped");
// });


app.use("/", routes);
app.use("/requests", adminRoutes);
app.use("/web",webRoutes);
app.use("/feedback",feedbackRouted);
app.use("/game",gameRoutes);


// 404 route (catch-all)
app.use((req, res) => {
  res.status(404).render("404", {
    title: "Page Not Found – VishLink",
    description: "The page you are looking for does not exist.",
    canonical: "https://wishlink-7j0a.onrender.com/404"
  });
});

app.listen(PORT, async (req, res) => {
  console.log(`Listning to port ${PORT}`);
  connectDb();
})

