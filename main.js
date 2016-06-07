// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var controls;
var bb_geometry;


var v3;

var datgui;
var settings;


// these globals hold the state of the cell the user is actively moving in move-cell mode.
// todo: refactor this sort of thing into a v3 manager class?
var moving_cell = -1;
var moving_plane; // plane in which movements will happen -- three.js has a plane.intersectLine() we can use (need to translate ray to line)
var moving_mouse_offset;
var moving_cell_geom;
var moving_cell_points;
var moving_cell_mat;
var moving_controls;

function reset_moving() {
    moving_cell = -1;
    moving_plane = undefined;
    moving_mouse_offset = undefined;
    moving_cell_geom = undefined;
    moving_cell_points = undefined;
    moving_cell_mat = undefined;
    moving_controls.detach();
}

Generators = {
    "uniform random": function(numpts, voro) {
        voro.add_cell([0,0,0], true);
        for (var i=0; i<numpts; i++) {
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], false);
        }
        
    },
    "regular grid": function(numpts, voro) {
        w = 9.9;
        n = Math.floor(Math.cbrt(numpts));
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w], (i+j+k)%2==1);
                }
            }
        }
//        var lastcellid = voro.add_cell([0,0,0], true); // add seed to click
    },
    "degenerating grid": function(numpts, voro) {
        var w = 9.9;
        
        var n = Math.floor(Math.cbrt(numpts));
        var rfac = 1.0/n;
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    var r = rfac*j;
                    voro.add_cell([i*2*w/n-w+Math.random()*r,j*2*w/n-w+Math.random()*r,k*2*w/n-w+Math.random()*r], (i+j+k)%2==1);
                }
            }
        }
    },
    "cylindrical columns": function(numpts, voro) {
        var n = Math.floor(Math.cbrt(numpts));
        var jitter = .1; // todo: expose jitter as param
        var w =9.99;
        voro.add_cell([0,0,0], true);
        for (var zi=0; zi<2*n+1; zi++) { // z
            var z = zi*w/n-w;
            for (var ri=0; ri<n*.5+1; ri++) { // radius
                var r = ri*(w-4)/(n*.5) + 4;
                for (var ti=0; ti<n+1; ti++) { // angle
                    var theta = ti*2*Math.PI/n;
                    voro.add_cell([r*Math.cos(theta)+Math.random()*jitter, r*Math.sin(theta)+Math.random()*jitter, z+Math.random()*jitter], ((zi%n)-ti)==0);
                }
            }
        }
    },
    "spherical spikes": function(numpts, voro) {
        for (var i = 0; i < numpts; i++) {
            var pt = [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10];
            var radtrue = Math.sqrt(pt[0]*pt[0]+pt[1]*pt[1]+pt[2]*pt[2]);
            var rad = .55;//+rndn()*.002;
            if (i > numpts/2) {
                rad = .3+.25*(pt[2]+1)*(pt[2]+1)*.1+Math.random()*.05;
            }
            if (radtrue > .00000001) {
                for (var ii=0; ii<3; ii++) {
                    pt[ii]*=5*rad/radtrue;
                }
            }
            var radfinal = Math.sqrt(pt[0]*pt[0]+pt[1]*pt[1]+pt[2]*pt[2]);
            voro.add_cell(pt, radfinal < 4);
        }
    }
};

var VoroSettings = function() {
    this.mode = 'add/delete';
    this.generator = 'uniform random';
    this.numpts = 1000;
    this.seed = 'qq';
    this.fill_level = 0.0;
    
    this.regenerate = function() {
        reset_moving();
        v3.generate(scene, [-10, -10, -10], [10, 10, 10], Generators[this.generator], this.numpts, this.seed, this.fill_level);
        render();
        
    };
};


function wait_for_ready() {
    if (ready_for_emscripten_calls) {
        init();
    } else {
        requestAnimationFrame( wait_for_ready );
    }
}
wait_for_ready();



function init() {
    Math.seedrandom('qq');
    
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 30;



    // create voro structure w/ bounding box
    v3 = new Voro3();
    
    var lights = [];
    lights[0] = new THREE.DirectionalLight( 0xcc9999 );
    lights[1] = new THREE.DirectionalLight( 0x99cc99 );
    lights[2] = new THREE.DirectionalLight( 0x9999cc );
    
    lights[3] = new THREE.DirectionalLight( 0xff9999 );
    lights[4] = new THREE.DirectionalLight( 0x99ff99 );
    lights[5] = new THREE.DirectionalLight( 0x9999ff );
    
    lights[0].position.set( 0, 1, 0 );
    lights[1].position.set( 1, 0, 0 );
    lights[2].position.set( 0, 0, 1 );
    lights[3].position.set( 0,-1, 0 );
    lights[4].position.set(-1, 0, 0 );
    lights[5].position.set( 0, 0,-1 );
    
    scene.add( lights[0] );
    scene.add( lights[1] );
    scene.add( lights[2] );
    scene.add( lights[3] );
    scene.add( lights[4] );
    scene.add( lights[5] );
    
    var bb_geom = new THREE.BoxGeometry( 20, 20, 20 );
    var bb_mat = new THREE.MeshBasicMaterial( { wireframe: true } );
    bounding_box_mesh = new THREE.Mesh( bb_geom, bb_mat );
    var bb_edges = new THREE.EdgesHelper(bounding_box_mesh);
    scene.add(bb_edges);


    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );
    document.addEventListener( 'mousemove', onDocumentMouseMove, false );
    document.addEventListener( 'mousedown', onDocumentMouseDown, false );
    document.addEventListener( 'keydown', onDocumentKeyDown, false );

    container = document.getElementById( 'container' );
    container.appendChild( renderer.domElement );
    
    controls = new THREE.TrackballControls( camera, renderer.domElement );
    controls.rotateSpeed = 10.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.keys = [ 65, 83, 68 ];
    controls.addEventListener( 'change', render );
    
    moving_controls = new THREE.TransformControls( camera, renderer.domElement );
    moving_controls.addEventListener( 'objectChange', moved_control );
    scene.add(moving_controls);
    
    datgui = new dat.GUI();
    settings = new VoroSettings();
    datgui.add(settings,'mode',['camera', 'toggle', 'add/delete', 'move']);
    
    var procgen = datgui.addFolder('Proc. Gen. Settings');
    
    procgen.add(settings,'seed');
    procgen.add(settings,'numpts').min(1);
    procgen.add(settings,'generator',Object.keys(Generators));
    var fill_controller = procgen.add(settings, 'fill_level', 0, 100);

    procgen.add(settings,'regenerate');
    
    settings.regenerate();
    
    animate();
    render();
}

function deselect_moving() {
    stop_moving();
    if (moving_controls) {
        moving_controls.detach();
    }
}

function onDocumentKeyDown( event ) {
    if (event.keyCode === 32) {
        if (settings.mode === 'toggle') {
            settings.mode = 'move';
        } else {
            settings.mode = 'toggle';
        }
        datgui.updateDisplays();
    }
    if (event.keyCode === 27) {
        deselect_moving();
        if (moving_controls) {
            moving_controls.detach();
        }
    }
    if (event.keyCode >= 'X'.charCodeAt() && event.keyCode <= 'Z'.charCodeAt()) {
        var axis = event.keyCode - 'X'.charCodeAt();
        controls.alignToAxis(axis);
        moving_cell = -1; // just disable any active moves; o.w. would need to recompute movement plane or movement would explode
        render();
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
    render();
}




function onDocumentMouseDown( event ) {
    
    if (settings.mode === 'toggle') {
        deselect_moving();
        if (event.button === 2) {
            var cell = v3.raycast(mouse, camera, raycaster);
            v3.toggle_cell(cell);
        } else {
            var cell = v3.raycast_neighbor(mouse, camera, raycaster);
            v3.toggle_cell(cell);
        }
        
        var nbr_cell = v3.raycast_neighbor(mouse, camera, raycaster);
        v3.set_preview(-1);
        // v3.set_preview(nbr_cell); // un-comment to make the next toggle preview pop up right away ... it's more responsive but feels worse to me.
    }
    if (settings.mode === 'add/delete') {
        if (event.button === 2) {
            var cell = v3.raycast(mouse, camera, raycaster);
            v3.delete_cell(cell);
            deselect_moving();
        } else {
            var pt = v3.raycast_pt(mouse, camera, raycaster);
            if (pt) {
                moving_cell = v3.add_cell(pt);
                start_moving_cell(moving_cell);
            }
        }
    }
    if (settings.mode === 'move') {
        if (moving_cell === -1 || !moving_cell_mat || !moving_cell_mat.visible) {
            
            
            moving_cell_new = v3.raycast(mouse, camera, raycaster);
            start_moving_cell(moving_cell_new);
        }
    }
    render();
}

function start_moving_cell(moving_cell_new) {
    if (moving_cell_new > -1) {
        document.addEventListener('mouseup', stop_moving, false);
        
        moving_cell = moving_cell_new;
        var n = camera.getWorldDirection();
        var p = new THREE.Vector3().fromArray(v3.cell_pos(moving_cell));
        moving_plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
        v3_set_moving_cell_geom(p);
        render();
        var p_on_screen = p.project(camera);
        moving_mouse_offset = p_on_screen.sub(mouse);
    }
}

function moved_control() {
    v3.move_cell(moving_cell, moving_cell_points.position.toArray());
    render();
}
function v3_set_moving_cell_geom(p) {
    if (!p) {
        if (moving_cell_mat) {
            moving_cell_mat.visible = false;
        }
        return;
    }
    if (!moving_cell_geom) {
        moving_cell_geom = new THREE.Geometry();
        moving_cell_geom.vertices.push(new THREE.Vector3());
        moving_cell_mat = new THREE.PointsMaterial( { size: .2, color: 0xff00ff, depthTest: false } );
        moving_cell_points = new THREE.Points(moving_cell_geom, moving_cell_mat);
        moving_cell_points.position.set(p.x,p.y,p.z);
        scene.add(moving_cell_points);
        moving_controls.attach(moving_cell_points);
    } else {
        moving_controls.attach(moving_cell_points);
        moving_cell_mat.visible = true;
        moving_cell_points.position.set(p.x,p.y,p.z);
    }
    
    
}
function movePerpToCam(camera, cell, dx, dy) {
    var raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    camera.up;
    raycaster.ray.direction;
}
function stop_moving() {
    v3_set_moving_cell_geom(undefined);
    // todo: this is where we'd push to the undo stack, etc.
    document.removeEventListener( 'mouseup', stop_moving );
}
function logv2(s,v){
    console.log(s + ": " + v.x + ", " + v.y);
}
function logv3(s,v){
    console.log(s + ": " + v.x + ", " + v.y + ", " + v.z);
}
function onDocumentMouseMove( event ) {
    event.preventDefault();
    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    if (moving_cell_mat && moving_cell_mat.visible && moving_plane) {
        var n = moving_plane.normal;
        
        var pos = mouse.add(moving_mouse_offset);
        var caster = new THREE.Raycaster();
        caster.setFromCamera(pos, camera);
        
        var endpt = new THREE.Vector3();
        endpt.copy(caster.ray.direction);
        endpt.multiplyScalar(1000);
        endpt.add(caster.ray.origin);
        
        rayline = new THREE.Line3(caster.ray.origin, endpt);
        var newpos = moving_plane.intersectLine(rayline);
        if (newpos) {
            v3.move_cell(moving_cell, newpos.toArray());
            v3_set_moving_cell_geom(newpos);
        }
    }
    
    v3.set_preview(-1);
    if (!moving_controls || !moving_controls.visible || !moving_controls._dragging) {
        var cell = v3.raycast(mouse, camera, raycaster);
        if (!controls.isActive()) {
            controls.dragEnabled = (cell < 0 || settings.mode === 'camera') && (!moving_controls || !moving_controls.axis);
            if (!controls.dragEnabled && settings.mode === 'toggle') {
                var nbr_cell = v3.raycast_neighbor(mouse, camera, raycaster);
                v3.set_preview(nbr_cell);
            }
        }
    }
    render();
}

function render() {
    moving_controls.update();
    renderer.render( scene, camera );
}

function animate() {    
    controls.update();

    requestAnimationFrame( animate );
}



