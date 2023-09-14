const net = require('net');
const axios = require('axios');
const FormData = require('form-data');

const offlineStatus = {
    signal: "OFFLINE"
};

const socketMap = new Map();
let signals = {};
let ganttDataList = [];

function addNewGantt(customerId, machineName, createdAt, operatorName, status, color, start, end, timestamp, timestampMs, jobId, interfaceName) {
    const ganttData = { customerId, machineName, createdAt, operatorName, status, color, start, end, timestamp, timestampMs, jobId, interfaceName};
    ganttDataList.push(ganttData);

    console.log('gantt', `${JSON.stringify(ganttDataList)}`);
}

console.log('Create Server!');

// Create a new server instance
const server = net.createServer((socket) => {
    // Handle incomming client connections
    console.log('New client connected!');
    socket.write("Welcome to MMS!");

    socketMap.set(socket, { customerId: null, machineName: null });

    // When data is received from a client
    socket.on('data', (data) => {
        console.log(`Received data: ${data.toString()}`);
        const[event, eventData] = data.toString().split('|||');
        
        let currTimeMilis = Date.now();

        if (event === 'signal') {
            const [customerId, machineName, fanucSignal, deviceTimeMilisString, createdAt, timestamp, interfaceName] = eventData.split(',');

            // Check Data
            if (customerId && machineName && fanucSignal && deviceTimeMilisString && createdAt && timestamp) {
                let deviceTimeMilis = parseInt(deviceTimeMilisString);

                // Save socket info
                socketMap.set(socket, { customerId: customerId, machineName: machineName });
                
                if (!signals[customerId]) {
                    signals[customerId] = {};
                }
                
                let signal = "Offline";
                let color = "#000000";
                if (fanucSignal === "INCYCLE") {
                    signal = "In Cycle";
                    color = "#46c392";
                } else if (fanucSignal === "UNCATE") {
                    signal = "Idle-Uncategorized";
                    color = "#ff0000";
                }

                // Signal Status
                if (!signals[customerId].hasOwnProperty(machineName)) {
                    // The case of the first signal on device
                    console.log('signal', 'First Signal!');

                    // Make new virtual segment to report status right away with the future time of 500ms.
                    // Add new gantt: signal - [deviceTimeMilis, deviceTimeMilis + 500]
                    addNewGantt(customerId, machineName, 
                        createdAt, "Unattended", signal, color, 
                        deviceTimeMilis, deviceTimeMilis + 500, 
                        timestamp, 0, "", interfaceName);

                    // New data
                    signals[customerId][machineName] = {
                        signal: signal,
                        deviceTimeMilis: deviceTimeMilis + 500,
                        serverTimeMilis: currTimeMilis + 500,
                        createdAt: createdAt,
                        timestamp: timestamp,
                        interfaceName: interfaceName,
                        lastReportTime: currTimeMilis + 500,
                        color: color,
                        operatorName: "Unattended",
                        jobId: "",
                    };
                } else if (signal !== signals[customerId][machineName].signal && 
                    (signal === "In Cycle" || signals[customerId][machineName].signal === "In Cycle")) {
                    // The case of different signal
                    console.log('signal', 'New Signal!');

                    let origianlObject = signals[customerId][machineName]

                    // Make new segment to report old status
                    // originalObject.signal - [originalObject.deviceTimeMilis, deviceTimeMilis]
                    addNewGantt(customerId, machineName, 
                        origianlObject.createdAt, origianlObject.operatorName, origianlObject.signal, origianlObject.color, 
                        origianlObject.deviceTimeMilis, deviceTimeMilis, 
                        origianlObject.timestamp, 0, origianlObject.jobId, origianlObject.interfaceName);

                    // Make new virtual segment to report the new status
                    // signal - [deviceTimeMilis, deviceTimeMilis + 500]
                    addNewGantt(customerId, machineName, 
                        createdAt, origianlObject.operatorName, signal, color, 
                        deviceTimeMilis, deviceTimeMilis + 500, 
                        timestamp, 0, origianlObject.jobId, interfaceName);

                    signals[customerId][machineName] = {
                        ...origianlObject,
                        signal: signal,
                        deviceTimeMilis: deviceTimeMilis + 500,
                        serverTimeMilis: currTimeMilis + 500,
                        createdAt: createdAt,
                        timestamp: timestamp,
                        interfaceName: interfaceName,
                        lastReportTime: currTimeMilis + 500,
                        color: color,
                    }    
                } else if (currTimeMilis - signals[customerId][machineName].serverTimeMilis >= 300000) {
                    // 5 mins passed with the same segment, report it.
                    console.log('signal', 'Signal after 5 mins!');

                    let origianlObject = signals[customerId][machineName]

                    // originalObject.signal - [originalObject.deviceTimeMilis, deviceTimeMilis]
                    addNewGantt(customerId, machineName, 
                        origianlObject.createdAt, origianlObject.operatorName, origianlObject.signal, origianlObject.color, 
                        origianlObject.deviceTimeMilis, deviceTimeMilis, 
                        origianlObject.timestamp, 0, origianlObject.jobId, origianlObject.interfaceName);

                    signals[customerId][machineName] = {
                        ...origianlObject,
                        signal: signal,
                        deviceTimeMilis: deviceTimeMilis,
                        serverTimeMilis: currTimeMilis,
                        createdAt: createdAt,
                        timestamp: timestamp,
                        interfaceName: interfaceName,
                        lastReportTime: currTimeMilis,
                        color: color,
                    }
                } else {
                    console.log('signal', 'Ignore!');
                }

                console.log('data', `${JSON.stringify(signals)}`);
            } else {
                console.log('data', 'Request Data Error!');
            }
        } else if (event === 'requestSignal') {
            const [customerId, machineName] = eventData.split(',');

            let response = offlineStatus;
            if (signals[customerId] && signals[customerId][machineName]) {
                let lastReportTime = signals[customerId][machineName]?.serverTimeMilis;
                // Check Offline status for 5 minutes
                if (currTimeMilis - lastReportTime <= 300000) {
                    response = {
                        signal: signals[customerId][machineName].signal
                    }
                }
            }

            socket.write(`responseSignal:${JSON.stringify(response)}`);
        } else if (event === 'updateSignal') {
            const [customerId, machineName, signal, color] = eventData.split(',');
            if (signals[customerId] && signals[customerId][machineName]) {
                if (signals[customerId][machineName].signal !== "INCYCLE") {
                    // Update Signal & Color
                    signals[customerId][machineName].signal = signal;
                    signals[customerId][machineName].color = color;
                }
            }
        }
    });

    // When a client close
    socket.on('close', () => {
        console.log('Client closed!');

        //console.log('sMap', socketMap.size);
        // Remove the socket reference from the socketMap
        const { customerId, machineName } = socketMap.get(socket);
        socketMap.delete(socket);

        // Remove data from signals object
        if (signals[customerId] && signals[customerId][machineName]) {
            delete signals[customerId][machineName];

            // Remove customer entry if no machines left
            if (Object.keys(signals[customerId]).length === 0) {
                delete signals[customerId];
            }
        }

        console.log('Current Clients', socketMap.size);
        //console.log('data', `${JSON.stringify(signals)}`);
    });

    // When a client disconnects
    socket.on('end', () => {
        console.log('Client disconnected!');
    });

    // When the error occurs
    socket.on('error', (error) => {
        console.error('An error occurred:', error);
    });
});

console.log('Created Server!');

// Start the server on a specific port
const port = 5050;
server.listen(port, ()=> {
    console.log(`Server listening on port ${port}`);
});

let isProcessing = false;
function processGanttData() {
    if (isProcessing) {
        // If data is already being processed, exit the function
        return; 
    }
  
    if (ganttDataList.length > 0) {
        isProcessing = true; // Set the flag to indicate that data processing has started
  
        const ganttData = ganttDataList.shift(); // Remove the first element from the list
    
        const formData = new FormData();
        formData.append('action', 0);
        formData.append('customer_id', ganttData.customerId);
        formData.append('machine_id', ganttData.machineName);

        formData.append('created_at', ganttData.createdAt);
        formData.append('Operator', ganttData.operatorName);
        formData.append('status', ganttData.status);
        formData.append('color', ganttData.color);
        
        formData.append('start', ganttData.start / 1000);
        formData.append('end', ganttData.end / 1000);
        
        formData.append('time_stamp', ganttData.timestamp);
        formData.append('time_stamp_ms', ganttData.timestampMs);
        formData.append('job_id', ganttData.jobId);
        formData.append('interface', ganttData.interfaceName);

        // Send HTTP POST request to the MMS server
        axios.post('https://api.slymms.com/api/postGanttData', formData)
        .then((response) => {
            console.log('gantt POST success!');
  
            // Process the next ganttData after the current one is completed
            isProcessing = false;
            processGanttData();
        })
        .catch((error) => {
            console.error('gantt POST error:', error);
  
            // Process the next ganttData after the current one is completed, even if an error occurred
            isProcessing = false;
            processGanttData();
        });
    }
}

// Separate loop for sending HTTP POST requests
setInterval(() => {
    processGanttData();
}, 1000);
