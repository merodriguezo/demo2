/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // conversation sdk
var DiscoveryV1 = require('watson-developer-cloud/discovery/v1'); // discovery sdk
var ibmdb = require('ibm_db');
var fs = require('fs');
var randomstring = require("randomstring");
var striptags = require('striptags');

var app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: false }));

// Create the service wrapper
var conversation = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  // username: '<username>',
  // password: '<password>',
  url: 'https://gateway.watsonplatform.net/conversation/api',
  version_date: '2017-04-21',
  version: 'v1',
  username: process.env.CONVERSATION_USERNAME,
  password: process.env.CONVERSATION_PASSWORD
});

// Create the service wrapper for Discovery
var discovery = new DiscoveryV1 ({
  // If unspecified here, the DISCOVERY_USERNAME and
  // DISCOVERY_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  // username: '<username>',
  // password: '<password>',
  version_date: DiscoveryV1.VERSION_DATE_2016_12_15,
  version: 'v1',
  username: 'd8b222cf-72c6-4787-a282-14a1cd94910c',
  password: 'XxwXJbaLxcpG'

});

//Declaración y parametrización del servicio de speech to text
//---------------------------------------------------------------------------------------------------------
var SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');

var speech_to_text = new SpeechToTextV1 ({
  username: '84f5bb32-713c-4b04-9d8b-9144e355e8f3',
  password: 'lLyF46vCljtC'
});

// speech_to_text
var params = {
    content_type: 'audio/wav',
    model: 'es-ES_BroadbandModel',
    continuous: true,
    interim_results: true
};

var TextToSpeechV1 = require('watson-developer-cloud/text-to-speech/v1');

var text_to_speech = new TextToSpeechV1 ({
  username: 'e3c351ef-25f0-4a8a-8a7e-e6b17603c580',
  password: 'sxgUgc0VtUq8'
});

var paramsTTS = {
  text: '',
  voice: 'es-LA_SofiaVoice',
  accept: 'audio/wav'
};
//---------------------------------------------------------------------------------------------------------

var db2;
var hasConnect = false;

//Dashdb configure
if (process.env.VCAP_SERVICES) { // Busca en las variables de ambiente si existen credenciales de una base de datos dashDB y las guarda en el objeto db2
  var env = JSON.parse(process.env.VCAP_SERVICES);
  if (env['dashDB']) {
    hasConnect = true;
    db2 = env['dashDB'][0].credentials;
  }
}
if ( hasConnect == false ) { // Si no encontró las credenciales en las variables de ambiente, le damos las credenciales manualmente para que las guarde
  db2 = {
    db: "BLUDB",
    hostname: "xxxx",
    port: 50000,
    username: "xxx",
    password: "xxx"
  };
}

// Utilizamos las credenciales guardadas en el objeto db2 para crear el string de conexión. Este string lo utilizamos mas adelante para conectarnos a la base de datos antes de hacer un query
var connString = "DRIVER={DB2};DATABASE=" + db2.db + ";UID=" + db2.username + ";PWD=" + db2.password + ";HOSTNAME=" + db2.hostname + ";port=" + db2.port;

//Configuración de http post para grabación y transcripción de texto
app.post("/sttana",function(req,res){
	var file = JSON.parse(req.body.archs);
	_upload(null, file.audio,function(transcrip){
		res.json( {text:transcrip});
	});

});



// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };




  // Send the input to the conversation service
  conversation.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }
    if (data.context.call_discovery) { // Revisamos si debemos invocar Discovery
      console.log("data.context.call_discovery == true");
      delete data.context.call_discovery; // Eliminamos la variable de contexto call_discovery para que las proximas llamadas no siempre invoquen Discovery

      // Invocamos Discovery porque existe la variable call_discovery
      discovery.query({
        environment_id: process.env.ENVIRONMENT_ID, // ID del ambiente de Discovery (variable de ambiente)
        collection_id: process.env.COLLECTION_ID, // ID de la coleccion de documentos (variable de ambiente)
        query: data.input.text, // Le pasamos a Discovery lo que escribió el usuario originalmente
        count: 3 // retornar maximo 5 documentos
      }, function (err, searchResponse) {
        data.output.text = []; // Borramos la respuesta original de Conversation, más adelante en la respuesta colocamos los documentos que retorna la consulta en Discovery

        if (err) { // Si hubo algun error invocando el servicio de discovery le avisamos al usuario
          console.error(err);
          console.log('Discovery error searching for documents: ' + err);
          data.output.text.push("Ocurrió un error inesperado en el servicio de Discovery.<br>Por favor, intenta nuevamente.");
        }
        else { // Si no hubo error, revisamos los resultados que retornó discovery
          var docs = searchResponse.results;

          if (docs.length > 0) { // Si encontró documentos, entonces le retornamos los documentos como respuesta al usuario
            console.log("Se encontraron ", docs.length, " documentos para el query de discovery");
            var responseText = "Excelente pregunta. Encontré algunas ideas para ti:<br>";

            for (var i = 0; i < docs.length; i++) { // Le aplicamos estilo a las respuestas
              responseText += "<div class='docContainer'>"+
                "<div title='Ver contenido' class='docBody'>"+
                    "<div class='docBodyTitle'>"+
                      docs[i].extracted_metadata.title +
                    "</div>"+
                    "<div class='docBodySnippet'>"+
                      //docs[i].text +
                    "</div>"+
                  "</div>"+
                  "<div class='modal' hidden>"+
                  "<div class='modal-header'>"+
                    "<div class='modal-doc'>"+
                      docs[i].extracted_metadata.title +
                    "</div>"+
                    "<span class='modal-close'>"+
                      "<img src='img/close-button.png' class='close-button'>"+
                    "</span>"+
                  "</div>"+
                  "<div class='bodyText'>"+
                    docs[i].text +
                  "</div>"+
                "</div>"+
              "</div>"+
              "<br>";
            }
            responseText = responseText.replace(/\n/g, "<br>"); //Reemplazamos los \n con <br> para que las respuestas tengan un formato legible en los navegadores

            data.output.text.push(responseText+ ". <br> Te puedo ayudar en algo más?"); // Colocamos los documentos como respuesta final al usuario

          }
          else { // Si no encontró ningún documento le avisamos al usuario
            console.log("se encontraron 0 documentos en Discovery.");
            data.output.text.push("Lo siento, no encontré nada para ayudarte con ese problema."+ ". <br> Te puedo ayudar en algo más?");
          }
        }
        //TTSAudioFile(data);
        //return res.json(data); // Le retornamos la respuesta con documentos al usuario
        return TTSAudioFile(data,function(){res.json(data);});
      });
    }
	// ---
    else if (data.context.buscarComuna){
    	console.log("data.context.buscarComuna == true");
    	delete data.context.buscarComuna;

      // Verificamos que tengamos el nombre ciudad
      if (data.context.nombreCiudad) {
        // Abrimos una conexión con la base de datos
        ibmdb.open(connString, function (err, conn) {
          if (err) { // Si ocurrió algún error al intentar conectarnos, abortamos y le avisamos al usuario
            console.log("Ocurrió un error al abrir la conexión: ", err.message);
            data.output.text = "Ocurrió un error al abrir la conexión con la base de datos, por favor intenta nuevamente.";

            //TTSAudioFile(data);
            //return res.json(data);
            return TTSAudioFile(data,function(){res.json(data);});
          }

          else { // Si no hubo error abriendo la conexión, pasamos a ejecutar el query de búsqueda de pedido
            conn.query("SELECT * FROM COSTOS_ENVIO WHERE LUGAR = '" + data.context.nombreCiudad + "' " , function (err, result) {
              if (err) { // Si ocurrió algún error al ejecutar la consulta, abortamos y le avisamos al usuario
                console.log("Ocurrió un error al ejecutar la consulta: ", err.message);
                data.output.text = "Ocurrió un error al ejecutar la consulta, por favor intenta nuevamente.";

                //TTSAudioFile(data);
                //return res.json(data);
                return TTSAudioFile(data,function(){res.json(data);});
              }
              else { // Si no hubo error ejecutando la consulta, verificamos los resultados

                if (result.length == 0) { // Si hay 0 resultados, significa que el usuario ingresó un nombre ciudad invalido (no existente)
                  data.output.text = "Lo siento, no tenemos despacho a esa ciudad de momento. Asegurate de que hayas escrito el nombre correctamente. <br> Te puedo ayudar en algo más?";

                }
                else { // Si existe un despacho  identificado con el nombre ingresado por usuario
                  data.output.text = "El despacho a " + result[0]['LUGAR'] + " tiene un valor de $ " + result[0]['COSTO'] +
		            "<br>" +
		            "Te puedo ayudar en algo más?";

                }

                conn.close(function () { // Verificamos que la conexión no quede abierta luego de ejecutar la consulta satisfactoriamente.
                  console.log("Se ejecutó la consulta y se cerró la conexión");
                });

                // Finalmente retornamos la respuesta al usuario según se haya encontrado o no el pedido
                //TTSAudioFile(data);
                //return res.json(data);
                return TTSAudioFile(data,function(){res.json(data);});
              }
            });
          }
        });
      }
    }
 // -
    else if (data.context.buscarDespacho) {
      console.log("data.context.buscarDespacho == true");
      delete data.context.buscarDespacho; // Eliminamos la variable de contexto buscarDespacho para que las proximas llamadas no siempre invoquen la busqueda de un despacho en la base de datos

      // Verificamos que tengamos el ID del pedido
      if (data.context.numeroDespacho) {
        // Abrimos una conexión con la base de datos
        ibmdb.open(connString, function (err, conn) {
          if (err) { // Si ocurrió algún error al intentar conectarnos, abortamos y le avisamos al usuario
            console.log("Ocurrió un error al abrir la conexión: ", err.message);
            data.output.text = "Ocurrió un error al abrir la conexión con la base de datos, por favor intenta nuevamente.";

            //TTSAudioFile(data);
            //return res.json(data);
            return TTSAudioFile(data,function(){res.json(data);});
          }
          else { // Si no hubo error abriendo la conexión, pasamos a ejecutar el query de búsqueda de pedido
            conn.query("SELECT * FROM ESTADO_DESPACHO WHERE IDPEDIDO = " + data.context.numeroDespacho, function (err, result) {
              if (err) { // Si ocurrió algún error al ejecutar la consulta, abortamos y le avisamos al usuario
                console.log("Ocurrió un error al ejecutar la consulta: ", err.message);
                data.output.text = "Ocurrió un error al ejecutar la consulta, por favor intenta nuevamente.";

                //TTSAudioFile(data);
                //return res.json(data);
                return TTSAudioFile(data,function(){res.json(data);});
              }
              else { // Si no hubo error ejecutando la consulta, verificamos los resultados

                if (result.length == 0) { // Si hay 0 resultados, significa que el usuario ingresó un numero de depacho invalido (no existente)
                  data.output.text = "Lo siento, no tenemos ningún registro con ese número de pedido. Asegurate de que hayas escrito el número correctamente.";
                }
                else { // Si existe un despacho  identificado con el id que dió el usuario
                	if (result[0]['ESTADO']=="atrasado"){
                	data.output.text = "Lamentamos informarle que el pedido con #" + result[0]['IDPEDIDO'] + " con destino a " + result[0]['DIRECCION'] + " se encuentra " + result[0]['ESTADO'] + ", nuestros ejecutivos se pondrán en contacto a la brevedad con usted para coordinar una pronta entrega. Te puedo ayudar en algo más?";
                	} else if (result[0]['ESTADO']=="en camino"){
                	data.output.text = "El pedido con #" + result[0]['IDPEDIDO'] + " con destino a " + result[0]['DIRECCION'] + " se encuentra " + result[0]['ESTADO'] + ", llegará de acuerdo a lo planificado. Te puedo ayudar en algo más?";
                	}
                	else{
                    data.output.text = "El pedido con #" + result[0]['IDPEDIDO'] + " con destino a " + result[0]['DIRECCION'] + " se encuentra " + result[0]['ESTADO'] + ". Te puedo ayudar en algo más?";
		            }

                }

                conn.close(function () { // Verificamos que la conexión no quede abierta luego de ejecutar la consulta satisfactoriamente.
                  console.log("Se ejecutó la consulta y se cerró la conexión");
                });

                // Finalmente retornamos la respuesta al usuario según se haya encontrado o no el pedido
                //TTSAudioFile(data);
                //return res.json(data);
                return TTSAudioFile(data,function(){res.json(data);});
              }
            });
          }
        });
      }
    }
    else { // Si no se debe invocar discovery ni ningún otro servicio, retornamos la respuesta normal de conversation
      //TTSAudioFile(data);
      return TTSAudioFile(data,function(){res.json(data);});
    }

  });
});

function _upload(response, file, cb) {
    var fileRootName = file.name.split('.').shift(),
        fileExtension = file.name.split('.').pop(),
        filePathBase = "./uploads/",
        fileRootNameWithBase = filePathBase + fileRootName,
        filePath = fileRootNameWithBase + '.' + fileExtension,
        fileID = 2,
        fileBuffer;

    while (fs.existsSync(filePath)) {
        filePath = fileRootNameWithBase + '(' + fileID + ').' + fileExtension;
        fileID += 1;
    }

    file.contents = file.contents.split(',').pop();

    fileBuffer = new Buffer(file.contents, "base64");

    fs.writeFileSync(filePath, fileBuffer);

    //--------------------------------------------------------------------------------------------------------------
    // Create the stream.
    var recognizeStream = speech_to_text.createRecognizeStream(params);

    // Pipe in the audio.
    fs.createReadStream(filePath).pipe(recognizeStream);

    // Pipe out the transcription to a file.
    recognizeStream.pipe(fs.createWriteStream('transcription.txt'));

    // Get strings instead of buffers from 'data' events.
    recognizeStream.setEncoding('utf8');

    // Listen for events.
    recognizeStream.on('results', function(event) { onEvent('Results:', event); });
    recognizeStream.on('data', function(event) { onEvent('Data:', event); });
    recognizeStream.on('error', function(event) { onEvent('Error:', event); });
    recognizeStream.on('close', function(event) { onEvent('Close:', event); });
    recognizeStream.on('speaker_labels', function(event) { onEvent('Speaker_Labels:', event); });

    var transcCompleta = "";
    // Displays events on the console.
    function onEvent(name, event) {
      if(name == "Data:"){
        transcCompleta+=JSON.stringify(event,null,2);
      }
      if(name == "Close:"){
      	transcCompleta = transcCompleta.replace(/"/g,"");
        console.log(transcCompleta);
        //Eliminar audio para que no se llene de archivos el servidor
        unlinkFile(filePath);
        cb(transcCompleta);
      }
    };


    //--------------------------------------------------------------------------------------------------------------
}

function unlinkFile(path) {
    try {
        fs.unlink(path, function(){
            console.log("Archivo temporal de audio eliminado");
        });
    }
    catch(e){}
}

//Configuración de http post para generación del audio basado en la rta de watson
//Pipe the synthesized text to a file.
function TTSAudioFile (data, cb){



	var textoConHtml;
	if(typeof data.output.text == "string"){
		textoConHtml = data.output.text;
	}
	else{
		textoConHtml = data.output.text[0];
	}

	textoConHtml = textoConHtml.replace(/"/g, "&quot;");
	paramsTTS.text = striptags(textoConHtml);
	var fileName = randomstring.generate()+".wav";
	console.log("Watson response to be synthesized: "+paramsTTS.text);
	text_to_speech.synthesize(paramsTTS).on('error', function(error) {
	  console.log('Error de Text to Speech:', error);
	}).pipe(fs.createWriteStream('public/downloads/'+fileName))
	.on("finish",function(){
		data.output.audio = fileName;
		cb();
	});
}


module.exports = app;
