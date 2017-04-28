

// fetching DOM references
var btnStartRecording = document.querySelector('#btn-start-recording');


//global variables
var currentBrowser = !!navigator.mozGetUserMedia ? 'firefox' : 'not_firefox';

if(currentBrowser == "not_firefox"){
    btnStartRecording.disabled = true;
    btnStartRecording.title = "Utilice Mozilla Firefox para grabar su pregunta";
    
}
else{
	btnStartRecording.disabled = false;
}

var grabando = false;
var fileName;
var audioRecorder;

// Firefox can record both audio/video in single webm container
// Don't need to create multiple instances of the RecordRTC for Firefox
// You can even use below property to force recording only audio blob on chrome
 var isRecordOnlyAudio = true;
//var isRecordOnlyAudio = !!navigator.mozGetUserMedia;

 function postFiles(audio, video) {
     // getting unique identifier for the file name
     fileName = generateRandomString();
     
     // this object is used to allow submitting multiple recorded blobs
     var files = { };

     // recorded audio blob
     files.audio = {
         name: fileName + '.wav', //+ audio.blob.type.split('/')[1], // MUST be wav or ogg. Modificado para que siempre tenga extensión wav para speech to text
         type: audio.blob.type,
         contents: audio.dataURL
     };
     
     
     files.uploadOnlyAudio = !video;
     
     
     $.post( "/sttana",{archs:JSON.stringify(files)}, function( data ) {
       $("#textInput").prop("disabled",false);
       $("#textInput").val(data.text);
       //console.log( data );
       btnStartRecording.disabled = false;
       btnStartRecording.innerText = "Grabar pregunta";
     });
     
     if(mediaStream) mediaStream.stop();
 }
 
//generating random string
 function generateRandomString() {
     if (window.crypto) {
         var a = window.crypto.getRandomValues(new Uint32Array(3)),
             token = '';
         for (var i = 0, l = a.length; i < l; i++) token += a[i].toString(36);
         return token;
     } else {
         return (Math.random() * new Date().getTime()).toString(36).replace( /\./g , '');
     }
 }
 
//when btnStopRecording is clicked
 function onStopRecording() {
     audioRecorder.getDataURL(function(audioDataURL) {
         var audio = {
             blob: audioRecorder.getBlob(),
             dataURL: audioDataURL
         };
         
         // if record only audio (either wav or ogg)
         if (isRecordOnlyAudio) postFiles(audio);
     });
 }
 
 var mediaStream = null;
 // reusable getUserMedia
 function captureUserMedia(success_callback) {
     var session = {
         audio: true
     };
     
     navigator.getUserMedia(session, success_callback, function(error) {
         alert( JSON.stringify(error) );
     });
 }
 
 //UI events handling
 btnStartRecording.onclick = function() {
	 if (grabando){
		 grabando = false;
		 btnStartRecording.disabled = true;
		 btnStartRecording.innerText = "Analizando audio";
	     
	     if(isRecordOnlyAudio) {
	         audioRecorder.stopRecording(onStopRecording);
	         return;
	     }
	 }
	 else{
		 grabando = true;
		 btnStartRecording.innerText = "Detener grabación";
		 
		 $("#textInput").prop("disabled",true);
	     
	     
	     captureUserMedia(function(stream) {
	         mediaStream = stream;
	         
	         // it is second parameter of the RecordRTC
			 var audioConfig = {};
			
			 if(currentBrowser == 'not_firefox') {
			     audioConfig.recorderType = StereoAudioRecorder;
			 }
			
			 
			 
			 audioRecorder = RecordRTC(stream, audioConfig);
			 
			 
			 
			 audioRecorder.startRecording();
			 
			 
		 });
	 }
	 
 };
