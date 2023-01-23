import express from "express";
import https from "httpolyglot";
import fs from "fs";
import path from "path";

const app = express();
const __dirname = path.resolve();

app.get('/',(req,res)=>{
    res.send('mediasoup app!');
});

// HTTPS & open ssl routes define.
const options  = {
    key: fs.readFileSync('./ssl/key.pem','utf-8'),
    cert: fs.readFileSync('./ssl/cert.pem','utf-8')
};

// run server
const httpsServer = https.createServer(options, app);
httpsServer.listen(3000,()=>{
    console.log('linsteing on port:'+3000);
});