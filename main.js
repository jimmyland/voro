// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var geometry, material, mesh, pointset;
var ptgeom, ptcloud;
var voro;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var controls;
var bb_geometry;

//var line;

var datgui;
var settings;

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
        generate(this.generator, this.numpts, this.seed, this.fill_level);
    };
};



function make_line(len) {
    var geometry = new THREE.BufferGeometry();
    geometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 4 * 3 ), len ) );
    var material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2, transparent: false } );
    var line = new THREE.Line( geometry, material );
    return line;
}


function wait_for_ready() {
    if (ready_for_emscripten_calls) {
        init();
    } else {
        requestAnimationFrame( wait_for_ready );
    }
}
wait_for_ready();

function v3_raycast_vertex_index(voro, mesh, mouse, camera, caster) {
    caster.setFromCamera(mouse, camera);

    var intersects = raycaster.intersectObject(mesh);
//    line.visible = intersects.length>0;
    if (intersects.length === 0)
        return -1;
    
    var intersect = intersects[0];
//    var face = intersect.face;
//    var linePosition = line.geometry.attributes.position;
//    var meshPosition = mesh.geometry.attributes.position;
//    linePosition.copyAt( 0, meshPosition, face.a );
//    linePosition.copyAt( 1, meshPosition, face.b );
//    linePosition.copyAt( 2, meshPosition, face.c );
//    linePosition.copyAt( 3, meshPosition, face.a );
//    line.geometry.attributes.position.needsUpdate = true;
    
    return intersect.index;
}

function v3_raycast_pt(mesh, mouse, camera, caster) {
    caster.setFromCamera(mouse, camera);
    
    var intersects = raycaster.intersectObject(mesh);
//    line.visible = intersects.length>0;
    if (intersects.length === 0)
        return null;
    
    var intersect = intersects[0];
    return intersect.point;
}
function v3_add_cell(voro, pt_3, geometry) {
    var pt = [pt_3.x, pt_3.y, pt_3.z];
    voro.add_cell(pt, true);
    v3_update_geometry(voro, geometry);
//    add_pt_to_scene(pt_3);
}


function v3_raycast(voro, mesh, mouse, camera, caster) {
    index = v3_raycast_vertex_index(voro, mesh, mouse, camera, caster)
    if (index < 0)
        return index;
    
    return voro.cell_from_vertex(index)
}
function v3_raycast_neighbor(voro, mesh, mouse, camera, caster) {
    index = v3_raycast_vertex_index(voro, mesh, mouse, camera, caster)
    if (index < 0)
        return index;
    
    return voro.cell_neighbor_from_vertex(index)
}

function v3_build_geometry(voro, settings) {
    var geometry = new THREE.BufferGeometry();
    var max_tris = 100000;
    voro.gl_build(max_tris /* initial guess at num tris needed */);
    var verts_ptr = voro.gl_vertices();
    var num_tris = voro.gl_tri_count();
    var max_tris = voro.gl_max_tris();
    var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_tris*3*3);
    var vertices = new THREE.BufferAttribute(array, 3);
    geometry.addAttribute('position', vertices);
    geometry.name = 'v3_voro';
    geometry.setDrawRange(0, num_tris*3);
    return geometry;
}

function v3_update_geometry(voro, geometry) {
    var num_tris = voro.gl_tri_count();
    geometry.setDrawRange(0, num_tris*3);
    geometry.attributes['position'].needsUpdate = true;
}

function v3_toggle_cell(voro, cell, geometry) {
    voro.toggle_cell(cell);
    v3_update_geometry(voro, geometry);
}

function v3_delete_cell(voro, cell, geometry) {
    voro.delete_cell(cell);
    v3_update_geometry(voro, geometry);
}

//function add_pt_to_scene(pos) {
//    var ptgeom = new THREE.Geometry();
//    ptgeom.vertices.push(pos);
//    var ptmat = new THREE.PointsMaterial( { size: .1, color: 0x0000ff, depthTest: false } );
//    var ptcloud = new THREE.Points(ptgeom, ptmat);
//    scene.add(ptcloud);
//}

//var geometry = v3_build_geometry(voro, {settings}); // build an actual threejs buffergeometry
// note: "geometry" object returned might not be a threejs geometry; might be an object that has a threejs buffergeometry and some extra info
//var gl_buffers = voro.build_gl_buffers(); // v3_build_geometry calls this

function generate(generator, numPts, seed, fill_level) {
    reset_moving();
    
    Math.seedrandom(seed);
    if (voro) {
        voro.delete();
    }
    voro = new Module.Voro([-10,-10,-10],[10,10,10]);
    Generators[generator](numPts, voro);
    if (fill_level == 0) {
        voro.set_only_centermost(1,0);
    } else {
        voro.set_fill(fill_level/100.0, Math.random()*2147483648);
    }
    
    geometry = v3_build_geometry(voro, {});
    
    
    
    material = new THREE.MeshPhongMaterial( { color: 0xaaaaaa, specular: 0x111111, shininess: 5, shading: THREE.FlatShading } ) ;
    //    material = new THREE.MeshBasicMaterial( { color: 0xffffff, wireframe: true } ) ;
    if (mesh) {
        scene.remove(mesh);
    }
    mesh = new THREE.Mesh( geometry, material );
    //    mesh.raycast = THREE.Mesh.prototype.raycast_fixed;
    scene.add( mesh );
}

function init() {
    Math.seedrandom('qq');
    
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 30;



    // create voro structure w/ bounding box
    
    
    
//    voro.delete();

//    add_pt_to_scene(new THREE.Vector3(0,0,0));
    
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

    
    
//    var ptsgeometry = new THREE.BufferGeometry();
//    var ptsarray = Module.HEAPF32.subarray(offset/4, offs  et/4 + numPts*3);
//    ptsverts = new THREE.BufferAttribute(ptsarray, 3);
//    ptsgeometry.addAttribute( 'position', ptsverts );
//    ptsmaterial = new THREE.PointsMaterial( { size: .1, color: 0x0000ff } );
//    pointset = new THREE.Points( ptsgeometry, ptsmaterial );
//    scene.add( pointset ); // no longer corresponds to vor                                                                                                                                                                                                                                                                                                                 o cells, todo fix and re-add

    
//    line = make_line(3);
//    scene.add(line);
//    edges = new THREE.EdgesHelper( mesh, 0x00ff00 ); scene.add( edges );

    
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
    datgui.add(settings,'mode',['camera', 'toggle', 'add/delete', 'move']).listen();
    
    var procgen = datgui.addFolder('Proc. Gen. Settings');
    
    procgen.add(settings,'seed');
    procgen.add(settings,'numpts').min(1);
    procgen.add(settings,'generator',Object.keys(Generators)).listen();
    var fill_controller = procgen.add(settings, 'fill_level', 0, 100);
    fill_controller.onChange(function(value)
    {
        if (value==0) voro.set_only_centermost(1,0);
        else voro.set_fill(value/100.0, Math.random()*100000);
        v3_update_geometry(voro, geometry);
    });

    procgen.add(settings,'regenerate');
    
    settings.regenerate();
    
    animate();
    render();
}

function onDocumentKeyDown( event ) {
    if (event.keyCode === 32) {
        if (settings.mode === 'toggle') {
            settings.mode = 'move';
        } else {
            settings.mode = 'toggle';
        }
    }
    if (event.keyCode === 27) {
        reset_moving();
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
    moving_cell_mat = undefined;
}


function onDocumentMouseDown( event ) {
    
    if (settings.mode === 'toggle') {
        if (event.button === 2) {
            var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
            v3_toggle_cell(voro, cell, geometry);
        } else {
            var cell = v3_raycast_neighbor(voro, mesh, mouse, camera, raycaster);
            v3_toggle_cell(voro, cell, geometry);
        }
        v3_raycast(voro, mesh, mouse, camera, raycaster);
        onChangeVertices();
    }
    if (settings.mode === 'add/delete') {
        if (event.button === 2) {
            var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
            v3_delete_cell(voro, cell, geometry);
        } else {
            var pt = v3_raycast_pt(mesh, mouse, camera, raycaster);
            if (pt) {
                v3_add_cell(voro, pt, geometry);
            }
        }
    }
    if (settings.mode === 'move') {
        if (moving_cell === -1 || !moving_cell_mat || !moving_cell_mat.visible) {
            
            document.addEventListener('mouseup', stopMoving, false);
            moving_cell_new = v3_raycast(voro, mesh, mouse, camera, raycaster);
            if (moving_cell_new > -1) {
                moving_cell = moving_cell_new;
                var n = camera.getWorldDirection();
                var p = new THREE.Vector3().fromArray(voro.cell_pos(moving_cell));
                moving_plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
                v3_set_moving_cell_geom(p);
                render();
                var p_on_screen = p.project(camera);
                moving_mouse_offset = p_on_screen.sub(mouse);
                
            }
        }
    }
}

function moved_control() {
    voro.move_cell(moving_cell, moving_cell_points.position.toArray());
    v3_update_geometry(voro, geometry);
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
function stopMoving() {
    v3_set_moving_cell_geom(undefined);
    // todo: this is where we'd push to the undo stack, etc.
    document.removeEventListener( 'mouseup', stopMoving );
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
    if (moving_cell_mat && moving_cell_mat.visible) {
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
            voro.move_cell(moving_cell, newpos.toArray());
            v3_update_geometry(voro, geometry);
            v3_set_moving_cell_geom(newpos);
        }
    }
    if (!moving_controls || !moving_controls.visible || !moving_controls._dragging) {
        var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
        if (!controls.isActive()) {
            controls.dragEnabled = cell < 0 || settings.mode === 'camera';
        }
    }
}

function render() {
    moving_controls.update();
    renderer.render( scene, camera );
}

function onChangeVertices() {
    geometry.attributes['position'].needsUpdate = true;
    render();
}

var chaos_limit = 1000;
function doChaos() {
    if (chaos_limit == null || chaos_limit-- > 0) {
        var choice = Math.random()*4;
        if (Math.floor(choice) === 0) {
            var cell = Math.floor(Math.random()*voro.cell_count());
            voro.toggle_cell(cell);
            voro.toggle_cell(cell);
            voro.toggle_cell(cell);
        }
        else if (Math.floor(choice) === 1) {
            voro.delete_cell(0);
            var cell = Math.floor(Math.random()*voro.cell_count());
            voro.delete_cell(cell);
            var cell = Math.floor(Math.random()*voro.cell_count());
            voro.delete_cell(cell);
            var cell = Math.floor(Math.random()*voro.cell_count());
            voro.delete_cell(cell);
//            voro.delete_cell(voro.cell_count()-1);
//            voro.delete_cell(voro.cell_count()-2);
//            voro.delete_cell(0);
        } else if (Math.floor(choice) === 2) {
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
            voro.add_cell([1,1,1], true);
            voro.add_cell([1+Math.random()*.001,1+Math.random()*.001,1+Math.random()*.001], true);
            
            voro.add_cell([0,Math.random()*.1-.05,0], true);
            voro.add_cell([0,Math.random()*1000-500,0], true);
        } else {
            voro.move_cell(Math.random()*voro.cell_count(),[Math.random()*20-10,Math.random()*20-10,Math.random()*20-10]);
            voro.move_cell(Math.random()*voro.cell_count(),[0,Math.random()*1000-500,0]);
            voro.move_cell(0,[0,Math.random()*40-20,0]);
            var pos = [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10];
            var cell = voro.add_cell(pos, true);
            voro.move_cell(cell,pos);
            pos[0] += .01;
            voro.move_cell(cell,pos);
//            voro.move_cell(Math.random()*voro.cell_count(),[Math.random()*20-10,Math.random()*20-10,Math.random()*20-10]);
        }
        v3_update_geometry(voro, geometry);
    }
    doneChaos();
}

function doneChaos() {
    if (chaos_limit !== null && chaos_limit === 0) {
        console.log("chaos over -- checking sanity at end ...");
        var sanity = voro.sanity("after chaos");
        console.log("sanity = " + sanity);
    }
}

function moveChaos() {
    if (chaos_limit == null || chaos_limit-- > 0) {
        voro.move_cell(1000, [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10]);
        v3_update_geometry(voro, geometry);
    }
    doneChaos();
}

function demoAnimation() {
    var d = new Date();
    var n = d.getTime();
    var t=n*.002;
    voro.move_cell(0, [0,Math.sin(t)*5,Math.cos(t)*5]);
    v3_update_geometry(voro, geometry);
}


function animate() {
//    doChaos();
//    moveChaos();
//    v3_toggle_cell(voro, Math.floor(Math.random()*voro.cell_count()), geometry);
    
//    demoAnimation();
    
    controls.update();
    onChangeVertices();
    requestAnimationFrame( animate );

}