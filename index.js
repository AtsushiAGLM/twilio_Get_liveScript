const WebSocket = require("ws");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });
const path = require("path");
const fs = require('fs');

if (!fs.existsSync('conversations.txt')) {
    fs.writeFileSync('conversations.txt', '');
}

const speech = require("@google-cloud/speech");
const client = new speech.SpeechClient();

const request = {
  config: {
    encoding: "MULAW",
    sampleRateHertz: 8000,
    languageCode: "ja-JP"
  },
  interimResults: true
};

wss.on("connection", function connection(ws) {
console.log("New Connection Initiated");

 let recognizeStream = null;
const SILENCE_THRESHOLD = 3;
let silenceCounter = 0;
let currentSentence = "";

// Moved silenceInterval definition here
let silenceInterval = null; // <-- CHANGED: Moved outside of the data callback

  ws.on("message", function incoming(message) {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log(`A new call has connected.`);

        recognizeStream = client
            .streamingRecognize(request)
            .on("error", console.error)
            .on("data", data => {
                const transcription = data.results[0].alternatives[0].transcript;
                currentSentence += transcription + ' ';

                // Reset silenceCounter only when new sentence starts
                if (transcription.endsWith('.')) {  // <-- CHANGED: Check if transcription ends with a period
                    silenceCounter = 0;
                }

                // Clear any existing intervals
                if (silenceInterval) {  // <-- CHANGED: Check if an interval already exists
                    clearInterval(silenceInterval);
                }

                silenceInterval = setInterval(() => {
                    silenceCounter++;
                    if (silenceCounter >= SILENCE_THRESHOLD) {
                        clearInterval(silenceInterval);
                        if (currentSentence.trim() !== "") {
                            fs.writeFileSync('conversations.txt', currentSentence.trim() + '\n'); // <-- CHANGED: appendFileSync
                            currentSentence = "";
                        }
                        silenceCounter = 0;
                    }
                }, 1000);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(
                            JSON.stringify({
                                event: "interim-transcription",
                                text: transcription,
                            })
                        );
                    }
                });
            });

        break;
      case "start":
        console.log(`Starting Media Stream ${msg.streamSid}`);
        break;
      case "media":
        if (recognizeStream && !recognizeStream.destroyed) {
            recognizeStream.write(msg.media.payload);
        } else {
            console.warn("Cannot write to a destroyed stream.");
        }
        break;
      case "stop":
        console.log(`Call Has Ended`);
        recognizeStream.destroy();
        // Clear any existing intervals when the call ends
        if (silenceInterval) {  // <-- CHANGED: Clear interval when call stops
            clearInterval(silenceInterval);
        }
        break;
    }
  });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "/index.html")));

app.post("/", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/"/>
      </Start>
      <Say>I will stream the next 60 seconds of audio through your websocket</Say>
      <Pause length="60" />
    </Response>
  `);
});

console.log("Listening at Port 8080");
server.listen(8080);
