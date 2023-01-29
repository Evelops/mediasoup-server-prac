import express from "express";
import https from "httpolyglot";
import fs from "fs";
import path from "path";
import Socket from "socket.io";
import * as mediasoup from "mediasoup";
// import { Producer } from "mediasoup-client/lib/Producer";


const app = express();
const __dirname = path.resolve();

app.get('*',(req,res, next)=>{
    const path ='/sfu/';

    if(req.path.indexOf(path) == 0 && req.path.length > path.length) return next();

    res.send(`통신할 SocketRoom 입력 'https://127.0.0.1/sfu/inputRoomName'`);
});

//rotuer
app.use('/sfu/:room',express.static(path.join(__dirname,'public')));

// openssl & https file read 
const options = {
    key: fs.readFileSync('./ssl/key.pem','utf-8'),
    cert: fs.readFileSync('./ssl/cert.pem','utf-8')
};

// binding port express
const httpsServer = https.createServer(options, app);
httpsServer.listen(3000,()=>{
    console.log('linsteing on port:'+3000);
});

//peer의 io 처리.
 const io = Socket(httpsServer);
 
 // 'mediasoup' namespace 등록  
 const connections = io.of('/mediasoup');
/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer 
 **/
let worker;
let rooms = {};        
let peers = {};         
let transports = [];  
let producers = [];     
let consumers = [];     


 // worker를 호출하는 함수 정의. 
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on('died', error => {

    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  })

  return worker;
}


worker = createWorker();


const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]

connections.on('connection', async socket => {
  console.log(socket.id);
  socket.emit('connection-success', {
    socketId: socket.id,
  });

  const removeItems = (items, socketId, type) => {
    items.forEach(item => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter(item => item.socketId !== socket.id);

    return items;
  }

  socket.on('disconnect', () => {
    // do some cleanup
    console.log('peer disconnected')
    consumers = removeItems(consumers, socket.id, 'consumer')
    producers = removeItems(producers, socket.id, 'producer')
    transports = removeItems(transports, socket.id, 'transport')

    const { roomName } = peers[socket.id]
    delete peers[socket.id]

    // remove socket from room
    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
    }
  })

  // 클라이언트에서 유저가 본인의 stream 정보를 받아 왔을 때, 처리되는 소켓 로직. 
  socket.on('joinRoom', async ({ roomName }, callback) => {
   
    const router1 = await createRoom(roomName, socket.id);

    // 클라이언트 소켓이 room에 합류시, 각 peer의 socket.id의 정보를 object 형식으로 저장.
    peers[socket.id] = {
      socket,
      roomName,           // peer가 접속한 socket roomName 
      transports: [],     //
      producers: [],      // 
      consumers: [],      // 
      peerDetails: {      //
        name: '',
        isAdmin: false,   // peer의 admin 여부 -> 추후 활용.
      }
    }

    // get Router RTP Capabilities
    const rtpCapabilities = router1.rtpCapabilities;

    // client에서 콜백 호출 이후, rtpCapabilities 전송.
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs, });
    }
    
    console.log(`Router ID: ${router1.id}`, peers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...peers, socketId],
    }

    return router1;
  }



  socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
    // get Room Name from Peer properties
    const roomName = peers[socket.id].roomName;

    const router = rooms[roomName].router;


    createWebRtcTransport(router).then(
      transport => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          }
        })

        // add transport to Peer's properties
        addTransport(transport, roomName, consumer);
      },
      error => {
        console.log(error);
      })
  })

  const addTransport = (transport, roomName, consumer) => {

    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer, }
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [
        ...peers[socket.id].transports,
        transport.id,
      ]
    }
  }

  const addProducer = (producer, roomName) => {
    producers = [
      ...producers,
      { socketId: socket.id, producer, roomName, }
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [
        ...peers[socket.id].producers,
        producer.id,
      ]
    }
  }

  const addConsumer = (consumer, roomName) => {
    // add the consumer to the consumers list
    consumers = [
      ...consumers,
      { socketId: socket.id, consumer, roomName, }
    ]

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [
        ...peers[socket.id].consumers,
        consumer.id,
      ]
    }
  }

  socket.on('getProducers', callback => {
    //return all producer transports
    const { roomName } = peers[socket.id]

    let producerList = []
    producers.forEach(producerData => {
      if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
        producerList = [...producerList, producerData.producer.id]
      }
    })

    // return the producer list back to the client
    callback(producerList)
  })

  const informConsumers = (roomName, socketId, id) => {
    console.log(`joined, id ${id} ${roomName}, ${socketId}`)
 
    producers.forEach(producerData => {
      if (producerData.socketId !== socketId && producerData.roomName === roomName) {
        const producerSocket = peers[producerData.socketId].socket
        // use socket to send producer id to producer
        producerSocket.emit('new-producer', { producerId: id })
      }
    })
  }

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
    return producerTransport.transport
  }


  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS parameter ->  ', { dtlsParameters })
    
    getTransport(socket.id).connect({ dtlsParameters })
  })


  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
   
    const producer = await getTransport(socket.id).produce({
      kind,
      rtpParameters,
    })


    const { roomName } = peers[socket.id]

    addProducer(producer, roomName)

    informConsumers(roomName, socket.id, producer.id)

    console.log('Producer ID: ', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('producer closed from transport');
      producer.close();
    });


    callback({
      id: producer.id,
      producersExist: producers.length>1 ? true : false
    });
  });


  socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
    console.log(`DTLS parameter =>  ${dtlsParameters}`);
    const consumerTransport = transports.find(transportData => (
      transportData.consumer && transportData.transport.id == serverConsumerTransportId
    )).transport
    await consumerTransport.connect({ dtlsParameters });
  })

  socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
    try {

      const { roomName } = peers[socket.id]
      const router = rooms[roomName].router
      let consumerTransport = transports.find(transportData => (
        transportData.consumer && transportData.transport.id == serverConsumerTransportId
      )).transport


      if (router.canConsume({
        producerId: remoteProducerId,
        rtpCapabilities
      })) {

        const consumer = await consumerTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        });

        consumer.on('transportclose', () => {
          console.log('consumer로 부터 transport closed');
        });

        consumer.on('producerclose', () => {
          console.log('producer의 consumer closed');
          socket.emit('producer-closed', { remoteProducerId });

          consumerTransport.close([]);
          transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id);
          consumer.close();
          consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id);
        })

        addConsumer(consumer, roomName);


        const params = {
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        }


        callback({ params });
      }
    } catch (error) {
      console.log(error.message)
      callback({
        params: {
          error: error
        }
      });
    }
  });

  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log('consumer resume');
    const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId);
    await consumer.resume();
  });
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {

      const webRtcTransport_options = {
        listenIps: [
          {
            ip: '0.0.0.0', // replace with relevant IP address
            announcedIp: '127.0.0.1',
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      }

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(webRtcTransport_options)
      console.log(`transport id: ${transport.id}`);

      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      })

      transport.on('close', () => {
        console.log('transport closed');
      });

      resolve(transport);

    } catch (error) {
      reject(error)
    }
  })
}