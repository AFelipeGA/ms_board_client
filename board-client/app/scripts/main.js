const socket = io('https://testwebrtcfelipe.herokuapp.com');
//const socket = io('localhost:3000');

var isPenDown = false;
 
var snapshot;

var defaultLineColor = '#000000';
var defaultLineThickness = 3;
var maxLineThickness = 30;
 

var localPen = {};
 

var localLineColor = defaultLineColor;
var localLineThickness = defaultLineThickness;
 
var bufferedPath = [];
var lastBufferTime = new Date().getTime();
 
var userCurrentPositions = {};
var userCommands = {};
var userColors = {};
var userThicknesses = {};
 

var canvas;
var context;
var DrawingCommands = {
                      LINE_TO:       'lineTo',
                      MOVE_TO:       'moveTo',
                      SET_THICKNESS: 'setThickness',
                      SET_COLOR:     'setColor',
                      DRAW_LINE:     'drawLine'
                      };
 

// The ID for a timer that sends the user's drawing path on a regular interval
var broadcastPathIntervalID;
// The ID for a timer that executes drawing commands sent by remote users
var processDrawingCommandsIntervalID;
 

var hasTouch = false;
 

//Init

window.onload = init;
 
function init () {
  initCanvas();
  initInput();
  registerInputListeners();
}
 
function initCanvas () {
  // Retrieve canvas reference
  canvas = document.getElementById('board');
 
  // Size canvas
  canvas.width  = 1280;
  canvas.height = 720;
 
  // Retrieve context reference, used to execute canvas drawing commands
  context = canvas.getContext('2d');
  context.lineCap = 'round';

}

function initInput() {
  var $box = $('#colorPicker');
  $box.tinycolorpicker();
  $box.data('plugin_tinycolorpicker').setColor('#000000');

  $box.bind('change', function(evt){
    let selectedColor = $box.data('plugin_tinycolorpicker').colorHex
    localLineColor =  selectedColor;
    broadcastColor(selectedColor);
  });

  var thicknessSelect = document.getElementById('thick-select');
  thicknessSelect.value = defaultLineThickness;

  thicknessSelect.addEventListener('change', function(evt){
    localLineThickness = evt.target.value;
    broadcastThickness(evt.target.value);
  })
}
 
// Register callback functions to handle user input
function registerInputListeners () {
  canvas.onmousedown = pointerDownListener;
  document.onmousemove = pointerMoveListener;
  document.onmouseup = pointerUpListener;
  document.ontouchstart = touchDownListener;
  document.ontouchmove = touchMoveListener;
  document.ontouchend = touchUpListener;

  processDrawingCommandsIntervalID = setInterval(processDrawingCommands, 20);


  socket.on('move', function(data){
    moveMessageListener(data.id, data.string)
  });
  socket.on('path', function(data){
    pathMessageListener(data.id, data.string)
  });
  socket.on('color', function(data){
    colorMessageListener(data.id, data.string);
  });
  socket.on('thickness', function(data){
    thicknessMessageListener(data.id, data.string);
  });
  socket.on('line', function(data){
    lineMessageListener(data.id, data.coords);
  })
}

function getType(){
  return document.querySelector('.typeCheckbox:checked').value;
}

function takeSnapshot() {
  snapshot = context.getImageData(0, 0, canvas.width, canvas.height);
}

function restoreSnapshot() {
  context.putImageData(snapshot, 0, 0);
}
 

// Triggered when a remote client sends a 'MOVE' message to this client
function moveMessageListener (fromClientID, coordsString){
  // Parse the specified (x, y) coordinate
  var coords = coordsString.split(',');
  var position = {x:parseInt(coords[0]), y:parseInt(coords[1])};
  // Push a 'moveTo' command onto the drawing-command stack for the sender
  addDrawingCommand(fromClientID, DrawingCommands.MOVE_TO, position);
}
 
// Triggered when a remote client sends a 'PATH' message to this client
function pathMessageListener (fromClientID, pathString){
  // Parse the specified list of points
  var path = pathString.split(',');
  // For each point, push a 'lineTo' command onto the drawing-command stack
  // for the sender
  var position;
  for (var i = 0; i < path.length; i+=2) {
    position = {x:parseInt(path[i]), y:parseInt(path[i+1])};
    addDrawingCommand(fromClientID, DrawingCommands.LINE_TO, position);
  }
}

function colorMessageListener (fromClientID, colorString){
  addDrawingCommand(fromClientID, DrawingCommands.SET_COLOR, colorString)
}

function thicknessMessageListener(fromClientID, thicknessString){
  addDrawingCommand(fromClientID, DrawingCommands.SET_THICKNESS, thicknessString)
}

function lineMessageListener(fromClientID, coords){
  addDrawingCommand(fromClientID, DrawingCommands.DRAW_LINE, coords);
}
 
//==============================================================================
// BROADCAST DRAWING DATA TO OTHER USERS
//==============================================================================
// Sends the local user's drawing-path information to other users in the
// drawing room.
function broadcastPath () {
  // If there aren't any points buffered (e.g., if the pen is down but not
  // moving), then don't send the PATH message.
  if (bufferedPath.length == 0) {
    return;
  }
  socket.emit('path', {string: bufferedPath.join(',')});
  // Clear the local user's outgoing path data
  bufferedPath = [];
  // If the user is no longer drawing, stop broadcasting drawing information
  if (!isPenDown) {
    clearInterval(broadcastPathIntervalID);
  }
}
 
// Sends all users in the drawing room an instruction to reposition the local
// user's pen.
function broadcastMove (x, y) {
  socket.emit('move', {string: x + ',' + y})
}

function broadcastColor (color) {
  socket.emit('color', {string: color});
}

function broadcastThickness (thickness) {
  socket.emit('thickness', {string: thickness});
}

function broadcastLine(coords) {
  socket.emit('line', {coords: coords});
}
 

function addDrawingCommand (clientID, commandName, arg) {
  // If this client does not yet have a command stack, make one.
  if (userCommands[clientID] == undefined) {
    userCommands[clientID] = [];
  }
  // Push the command onto the stack.
  var command = {};
  command['commandName'] = commandName;
  command['arg'] = arg;
  userCommands[clientID].push(command);
}
 
// Executes the oldest command on all user's command stacks
function processDrawingCommands () {
  var command;
  // Loop over all command stacks
  for (var clientID in userCommands) {
    // Skip empty stacks
    if (userCommands[clientID].length == 0) {
      continue;
    }
 
    // Execute the user's oldest command
    command = userCommands[clientID].shift();
    switch (command.commandName) {
      case DrawingCommands.MOVE_TO:
        userCurrentPositions[clientID] = {x:command.arg.x, y:command.arg.y};
        break;
 
      case DrawingCommands.LINE_TO:
        if (userCurrentPositions[clientID] == undefined) {
          userCurrentPositions[clientID] = {x:command.arg.x, y:command.arg.y};
        } else {
          drawLine(userColors[clientID] || defaultLineColor,
                   userThicknesses[clientID] || defaultLineThickness,
                   userCurrentPositions[clientID].x,
                   userCurrentPositions[clientID].y,
                   command.arg.x,
                   command.arg.y);
           userCurrentPositions[clientID].x = command.arg.x;
           userCurrentPositions[clientID].y = command.arg.y;
        }
        break;
 
      case DrawingCommands.SET_THICKNESS:
        userThicknesses[clientID] = command.arg;
        break;
 
      case DrawingCommands.SET_COLOR:
        userColors[clientID] = command.arg;
        break;

      case DrawingCommands.DRAW_LINE:
        console.log(command.arg);
        drawLine(userColors[clientID] || defaultLineColor,
          userThicknesses[clientID] || defaultLineThickness,
          command.arg.start.x,
          command.arg.start.y,
          command.arg.end.x,
          command.arg.end.x);
        break;
    }
  }
}
 
function touchDownListener (e) {
  hasTouch = true;
  if (event.target.nodeName != 'SELECT') {
    e.preventDefault();
  }
  // Determine where the user touched screen.
  var touchX = e.changedTouches[0].clientX - canvas.offsetLeft;
  var touchY = e.changedTouches[0].clientY - canvas.offsetTop;
  // A second 'touch start' event may occur if the user touches the screen with
  // two fingers. Ignore the second event if the pen is already down.
  if (!isPenDown) {
    // Move the drawing pen to the position that was touched
    penDown(touchX, touchY);
  }
}
 
// On devices that support touch input, this function is triggered when the user
// drags a finger across the screen.
function touchMoveListener (e) {
  hasTouch = true;
  e.preventDefault();
  var touchX = e.changedTouches[0].clientX - canvas.offsetLeft;
  var touchY = e.changedTouches[0].clientY - canvas.offsetTop;
  // Draw a line to the position being touched.
  penMove(touchX, touchY);
}
 
// On devices that support touch input, this function is triggered when the
// user stops touching the screen.
function touchUpListener () {
  // 'Lift' the drawing pen, so lines are no longer drawn
  hasTouch = true;
  e.preventDefault();
  var touchX = e.changedTouches[0].clientX - canvas.offsetLeft;
  var touchY = e.changedTouches[0].clientY - canvas.offsetTop;
  penUp(touchX, touchY);
}
 
//==============================================================================
// MOUSE-INPUT EVENT LISTENERS
//==============================================================================
// Triggered when the mouse is pressed down
function pointerDownListener (e) {
  // If this is an iPhone, iPad, Android, or other touch-capable device, ignore
  // simulated mouse input.
  if (hasTouch) {
    return;
  }
 
  // Retrieve a reference to the Event object for this mousedown event.
  // Internet Explorer uses window.event; other browsers use the event parameter
  var event = e || window.event;
  // Determine where the user clicked the mouse.
  var mouseX = event.clientX - canvas.offsetLeft;
  var mouseY = event.clientY - canvas.offsetTop;
 
  // Move the drawing pen to the position that was clicked
  penDown(mouseX, mouseY);
 
  // We want mouse input to be used for drawing only, so we need to stop the
  // browser from/ performing default mouse actions, such as text selection.
  // In Internet Explorer, we 'prevent default actions' by returning false. In
  // other browsers, we invoke event.preventDefault().
  if (event.preventDefault) {
    if (event.target.nodeName != 'SELECT') {
      event.preventDefault();
    }
  } else {
    return false;  // IE
  }
}
 
// Triggered when the mouse moves
function pointerMoveListener (e) {
  if (hasTouch) {
    return;
  }
  var event = e || window.event; // IE uses window.event, not e
  var mouseX = event.clientX - canvas.offsetLeft;
  var mouseY = event.clientY - canvas.offsetTop;
 
  // Draw a line if the pen is down
  penMove(mouseX, mouseY);
 
  // Prevent default browser actions, such as text selection
  if (event.preventDefault) {
    event.preventDefault();
  } else {
    return false;  // IE
  }
}
 
// Triggered when the mouse button is released
function pointerUpListener (e) {
  if (hasTouch) {
    return;
  }
  var event = e || window.event; // IE uses window.event, not e
  var mouseX = event.clientX - canvas.offsetLeft;
  var mouseY = event.clientY - canvas.offsetTop;
  // 'Lift' the drawing pen
  penUp(mouseX, mouseY);
}
 
//==============================================================================
// PEN
//==============================================================================
// Places the pen in the specified location without drawing a line. If the pen
// subsequently moves, a line will be drawn.
function penDown (x, y) {
  isPenDown = true;
  localPen.x = x;
  localPen.y = y;
 
  // Send this user's new pen position to other users.
  
  switch(getType()){
    case 'point':
      broadcastPathIntervalID = setInterval(broadcastPath, 500);
      broadcastMove(x, y);
      break;
    case 'line':
      broadcastPathIntervalID = setInterval(broadcastPath, 100);
      broadcastMove(x, y);
      takeSnapshot(); 
      break;
  }
}
 
// Draws a line if the pen is down.
function penMove (x, y) {
  if (isPenDown) {
    // Buffer the new position for broadcast to other users. Buffer a maximum
    // of 100 points per second.
    switch(getType()){
      case 'point':
        if ((new Date().getTime() - lastBufferTime) > 10) {
          bufferedPath.push(x + ',' + y);
          lastBufferTime = new Date().getTime();
        }
    
        // Draw the line locally.
        drawLine(localLineColor, localLineThickness, localPen.x, localPen.y, x, y);
    
        // Move the pen to the end of the line that was just drawn.
        localPen.x = x;
        localPen.y = y;
        break;
      case 'line':
        restoreSnapshot();
        drawLine(localLineColor, localLineThickness, localPen.x, localPen.y, x, y);
        break;
    }
  }
}
 
// 'Lifts' the drawing pen, so that lines are no longer draw when the mouse or
// touch-input device moves.
function penUp (x, y) {
  if(isPenDown){
    switch(getType()){
      case 'point':
        break;
      case 'line':
        restoreSnapshot();
        drawLine(localLineColor, localLineThickness, localPen.x, localPen.y, x, y);
        //broadcastLine({start:{x: localPen.x, y: localPen.y}, end:{x: x, y: y}});
        bufferedPath.push(localPen.x + ',' + localPen.y);
        bufferedPath.push(x + ',' + y);
        broadcastMove(x, y);
        break;
    }
  }
  isPenDown = false;
}
 
//==============================================================================
// DRAWING
//==============================================================================
// Draws a line on the HTML5 canvas
function drawLine (color, thickness, x1, y1, x2, y2) {
  context.strokeStyle = color;
  context.lineWidth   = thickness;
 
  context.beginPath();
  context.moveTo(x1, y1)
  context.lineTo(x2, y2);
  context.stroke();
}
 
//==============================================================================
// DATA VALIDATION
//==============================================================================
function getValidThickness (value) {
  value = parseInt(value);
  var thickness = isNaN(value) ? defaultLineThickness : value;
  return Math.max(1, Math.min(thickness, maxLineThickness));
}