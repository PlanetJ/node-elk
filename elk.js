var Buffer = require('buffer').Buffer
    , ev = require('events')
    , emitter = module.exports = new ev.EventEmitter()
    , time = require('time')
    , logger = require('logly')
    , named = require('named-regexp').named
    , _s = require('underscore.string')
    , net = require('net')
    , Readable = require('stream').Readable;

var parserMode = { raw:false };
var serialport = require("serialport");
var SerialPort = serialport.SerialPort; // localize object constructor
var sp = new SerialPort("/dev/ttyO1", { 
    baudrate: 9600,
    parser: serialport.parsers.hybrid("\r\n", parserMode)
});

var elkrp = null;
var elkrpBridge = net.createServer(function(c){
    if(elkrp){
        c.destroy();
        logger.log("Connection closed, only 1 ElkRP allowed");
    }else{
        elkrp = c;
        var close = function(){
            if(elkrp){
                elkrp = null
                parserMode.raw = false;
                logger.log("ElkRP Disconnected");
            }
        }
        elkrp.on("close",close);
        elkrp.on("end", close);
        elkrp.on('error', close);
        parserMode.raw = true;
        elkrp.on("data", function(data){
            sp.write(data); 
        });
        logger.log("ElkRP Connected");
    }
});
elkrpBridge.listen(45000, function(){
    logger.log("ElkRP Bridge listening on port 45000");    
});

var tcpBridgeServer = net.createServer(function(c){
    c.on("data", function(data){
        logger.log("TCP RECV: "+data.toString().trim());
        if(/^..sd1(8|9).*$/.test(data.toString().trim())){
            var resp = wrapLine("SD1"+data.slice(5, 9).toString()+"                00")+"\r\n";
            logger.log("Got audio sd, replying "+resp);
            c.write(resp);
        }else{
            sp.write(data);
        }
    });

    var onData = function(line){
        if(!elkrp){
            c.write(line + "\r\n");
        }
    };
    sp.on('data', onData);
    
    c.on('close', function(){
        logger.log("Client "+c.remoteAddress+" disconnected");
        sp.removeListener('data', onData);
    });
    
    logger.log("Client "+c.remoteAddress+" connected");
});
tcpBridgeServer.listen(2101, function(){
    logger.log("TCP Bridge listening on 2101");
});

sp.on("data", function(data){
    var line = new String(data);
    if(elkrp){
        elkrp.write(data);  
    }else{
        if(checkLine(line)){
            logger.log("Recv:"+line);
            var cmd = line.substring(2,4);
            if(typeof(handler[cmd]) == "function"){
                handler[cmd].call(null, line.substring(4,line.length-4));
            }
        }
    }
});

var handler = {
    AT:function(cmd){
        send("at");
    },
    AR:function(cmd){
        send('ar');
    },
    XK:function(cmd){
        send("xk");
        var res = named(/^(:<sec>\d\d)(:<min>\d\d)(:<hour>\d\d)(:<weekday>\d)(:<day>\d\d)(:<month>\d\d)(:<year>\d\d)(:<dst>\d)(:<cmode>\d)(:<dmode>\d)$/).exec(cmd).captures;
        emitter.emit("pulse", new time.Date(Number(res.year) + 2000, 
            Number(res.month) - 1, Number(res.day), Number(res.hour), Number(res.min), Number(res.sec), 'EST5EDT'));
    }
};

function send(cmd){
    var response = wrapLine(cmd+"00");
    logger.log("Send:"+response);
    sp.write(response+"\n");   
}

function checkLine(line){
    return line.length > 2
        && line.length - 2 == Number("0x"+line.substring(0,2))
        && line.split('').reduce(function(pv,cv,i,obj){
                if(i >= obj.length - 2) return pv;
                return Number((pv + cv.charCodeAt(0)) & 0xff);
            }, Number("0x"+line.substring(line.length-2))) == 0;
}

function wrapLine(line){
    var l = _s.pad((line.length + 2).toString(16), 2, '0').toUpperCase() + line;
    var cs = (l.split('').reduce(
        function(pv, cv, i, obj){
            return Number((pv + cv.charCodeAt(0)) & 0xff)
        }, 0) ^ 0xff) + 1;
    return l + _s.pad(cs.toString(16),2,'0').toUpperCase();
}
