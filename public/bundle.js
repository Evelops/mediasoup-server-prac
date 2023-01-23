(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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
},{}]},{},[1]);
