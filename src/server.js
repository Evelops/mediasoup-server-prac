import express from "express";
import https from "httpolyglot";
import fs from "fs";
import path from "path";
import Socket from "socket.io";
import * as mediasoup from "mediasoup";
import { Producer } from "mediasoup-client/lib/Producer";


const app = express();
const __dirname = path.resolve();

app.get('/',(req,res)=>{
    res.send('mediasoup app!');
});

// HTTPS & open ssl routes define.
const options = {
    key: fs.readFileSync('./ssl/key.pem','utf-8'),
    cert: fs.readFileSync('./ssl/cert.pem','utf-8')
};

//rotuer
app.use('/sfu',express.static(path.join(__dirname,'/public')));


// run server
const httpsServer = https.createServer(options, app);
httpsServer.listen(3000,()=>{
    console.log('linsteing on port:'+3000);
});

//peer의 io 처리.
 const io = Socket(httpsServer);
 
 // 'mediasoup' namespace 등록  
 const peers = io.of('/mediasoup');

/**
 * mediasoup architeture 에서 router 생성을 위한 worker 정의 .
 * worker는 미디어 서버를 구성하는 싱글 CPU 코어당 한 개씩 생성됨 -> Mediasoup architecture 구성도 참고. 
 * */ 
 let worker;
// worker로 부터 생성되는 router 정의, mediasoup의 router에서 socket.io를 사용한 signaling 과정을 중계.
 let router;
 let producerTransport; 
 let consumerTransport;
 let producer;
 let consumer;

 // worker를 호출하는 함수 정의. 
 const createWorker = async () => {
    // 생성한 worker에 Min & Max rtc port 지정. -> docker-compose에서 설정해준 값 지정.
    worker = await mediasoup.createWorker({
        rtcMinPort:2000,
        rtcMaxPort:2020,
    });

    console.log(`worker pid ${worker.pid}`);
    // mediasoup의 worker가 죽었을 때, handling
    worker.on('died', error => {
        console.error('mediasoup worker died');
        setTimeout(() => process.exit(1), 2000);
    });
    return worker;
 }

 worker = createWorker();
 
 //router에서 미디어 스트림을 처리할 audio, video 코덱 정의.
 const mediaCodecs = [
    {
        kind:'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind:'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },
    },
 ]

//peers 네임스페이스를 기반으로 소켓 연결 + 클라이언트에게 connecdtion-success 값과 socketId 값을 전송. signaling
 peers.on('connection',async socket => {
    console.log(socket.id);
    socket.emit('connection-success',{
        socketId:socket.id 
    });

    socket.on('diconnect', ()=>{
        console.log('peer disconneted');
    });

    router = await worker.createRouter({mediaCodecs});
    
    // peer에서 전송한 rtpCapabilities info 획득.
    socket.on('getRtpCapabilities',(callback) => {
        const rtpCapabilities = router.rtpCapabilities;
        console.log(`RTP Capabilities: ${rtpCapabilities}`);
        callback({rtpCapabilities});
    });

    socket.on('createWebRtcTransport', async({sender}, callback)=> {
        console.log(sender);
        if(sender){
            producerTransport = await createWebRtcTransport(callback);
        }else{
            consumerTransport = await createWebRtcTransport(callback);
        }
    });
    socket.on('transport-connect', async({dtlsParameters})=> {
        console.log('DTLs Params : ',{dtlsParameters});
        await producerTransport.connect({ dtlsParameters });
    });

    socket.on('transport-produce', async ({kind, rtpParameters, appData},callback)=>{
         producer = await producerTransport.produce({
            kind,
            rtpParameters,
         });

         console.log('Producer ID:',producer.id, producer.kind);

         producer.on('transportclose', () => {
            console.log('transport for this producer clodsed');
            producer.close();
         });
         callback({
            id:producer.id
         });
    });
 });

/** webRTC transport를 처리하는 로직.*/
const createWebRtcTransport = async (callback) => {
    try{
        const webRtcTransport_options = {
            listenIps: [
                {
                    ip:'127.0.0.1'
                }
            ],
            enableUdp:true,
            enableTcp:true,
            preferUdp:true,
        }
        let transport = await router.createWebRtcTransport(webRtcTransport_options);
        console.log(`transportId : ${transport.id}`);

        transport.on('dtlsstatechange',dtlsState =>{
            if(dtlsState === 'closed'){
                transport.close(); 
            }
        });
        transport.on('close',()=> {
            console.log('transport closed');
        });

        callback({
            params:{
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        });
        return transport;
         
    }catch(error){
        console.log(error);
        callback({
            params: {
                error:error
            }
        })

    }
}