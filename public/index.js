const socket = io("/mediasoup");

socket.on('connection-success', (socketId) => {
    console.log(socketId);
});

let params ={};

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

btnLocalVideo.addEventListener('click',handleLocalStream);