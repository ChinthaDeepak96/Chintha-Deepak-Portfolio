// Minimal Express server to run locally and accept auth requests
// NOTE: This is a development stub. Do not use the hard-coded secret in production.

const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());

// Serve static frontend files from the project root (put index.html in same folder)
app.use(express.static(path.join(__dirname)));

// simple health
app.get('/ping', (req,res)=>res.json({pong:true}));

// stub endpoints (you will wire to MongoDB later)
app.post('/api/signup', (req,res)=>{
const { email } = req.body;
// pretend to create a user
return res.json({ ok:true, email });
});
app.post('/api/login', (req,res)=>{
const { email } = req.body;
return res.json({ ok:true, token: 'dev-token-123', email });
});

const port = process.env.PORT || 4000;
app.listen(port, ()=>console.log('Dev server running on', port));

