const mediasoupClient = require('mediasoup-client');
const { Producer } = require('mediasoup-client/lib/Producer');
const socket = io("/mediasoup");

//media 서버와 연결 성공시, socketID 반환.
socket.on('connection-success', (socketId) => {
  console.log(socketId);
});

//mediasoup-clinet 의 endpoint에서 device info define.
let device;
let rtpCapabilities;
let producerTransport;
let producer;

let params ={
   //mediasoup params 
   encoding: [
    {
      rid:'r0',
      maxBitrate: 100000,
      scalabilityMode : 'S1T3'
    },
    {
      rid:'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid:'r2',
      maxBitrate: 190000,
      scalabilityMode: 'S1T3',
    },
  ],
  dodecOptions: {
    videoGoogleStartBitrate: 1000
  }
};

// Stream 획득시, 실행되는 콜백 메서드.
const streamSuccess = async (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params
  }
}

// getSteram method
const handleLocalStream = () =>{
  navigator.getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        }
      }
    }, streamSuccess, error => {
      console.log(error.message);
    });
}


//peer의 device 를 가져오고, RtpCapabilites 정보를 획득하는 메서드.
const createDevice = async () => {
  try{
    //mediasoupClient의 device 정보 get
    device = new mediasoupClient.Device(); 

    // rtpCapabilities -> 미디어 수신 정보를 get
    await device.load({
      routerRtpCapabilities: rtpCapabilities, 
    });
 
    console.log('Peer의 RTP Capabilites 정보:',device.rtpCapabilities);

  }catch(error){
    console.log(`Client의 Device 생성에서 에러: ${error}`);
    if(error.name === 'UnsupportedError'){
      console.warn('지원하지 않은 브라우저 입니다.');
    }
  }
}

/**
 *  각 peer의 endpoint를 mediasoup server를 연결하는 transport 생성.
 *  서버에게 webRTC transport 전송 해주는 메서드.
*/
const createSendTransport = () =>{
  socket.emit('createWebRtcTransport',{sender:true},({params}) => {
    if(params.error){
      console.log(params.error);
      return
    }
    console.log(params);
    //미디어 전송을 위한 새로운 webRTC transport 생성.
    producerTransport = device.createSendTransport(params);

    producerTransport.on('connect',async({dtlsParameters},callback,errback)=>{
      try {
        // server side로 DTLS 매개 값 전송.
        await socket.emit('transport-connect', {
          // transportId: producerTransport.id,
          dtlsParameters: dtlsParameters,
        });
        callback();
      }catch(error){
        errback(error);
      }
    });

    producerTransport.on('produce', async (parameters, callback, errback)=>{
      console.log(parameters);
      try{
        await socket.emit('transport-produce',{
          // transportId:producerTransport.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        },({ id }) => {
          callback({ id });
        });
      }catch(error){
        errback(error);
      }
    });
  });
}
const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);
  producer.on('trackended', () => {
   console.log('track ended');
  });
  producer.on('transportclose', () => {
    console.log('transport ended')
    // close video track
  });
 }

 
 // create Recv Transport 
 const createRecvTransport = async () => {
  await socket.emit('createWebRtcTransport',{sender:false},({ params })=>{
    if(params.error){
      console.log(params.error);
      return;  
    }

    
    console.log(params);
  });
 }




//send Peer RtpCapabilities with mediasoup Server
const getRtpCapabilities = () => {
  console.log('click');
  socket.emit('getRtpCapabilities',(data) => {
    console.log(`send Router with RTP Capabilities info: ${data.rtpCapabilities}`);

    rtpCapabilities = data.rtpCapabilities;
  });
}


//mediasoup에서 stream의 flow를 확인하는 listner 정의.
btnLocalVideo.addEventListener('click',handleLocalStream);
btnRtpCapabilities.addEventListener('click',getRtpCapabilities);
btnDevice.addEventListener('click',createDevice);
btnCreateSendTransport.addEventListener('click',createSendTransport);
btnConnectSendTransport.addEventListener('click',connectSendTransport);
btnRecvSendTransport.addEventListener('click',createRecvTransport);