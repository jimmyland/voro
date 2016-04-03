// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var geometry, material, mesh, pointset;
var vertices, offset;


function init() {

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 10;
    
    controls = new THREE.TrackballControls( camera );
    controls.rotateSpeed = 10.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.keys = [ 65, 83, 68 ];
    controls.addEventListener( 'change', render );

    
    geometry = new THREE.BufferGeometry();
    var numPts = 1000;
    offset = _malloc(numPts * 4 * 3);
    _randomPoints(numPts, offset, -10, 10);
    var array = Module.HEAPF32.subarray(offset/4, offset/4 + numPts*3);
    vertices = new THREE.BufferAttribute(array, 3);
    geometry.addAttribute( 'position', vertices );

//    material = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
//    mesh = new THREE.Mesh( geometry, material );
//    mesh = new THREE.Mesh( geometry, material );
//        scene.add( mesh );
    
    material = new THREE.PointsMaterial( { size: .1, color: 0xff0000 } );
    pointset = new THREE.Points( geometry, material );
    scene.add( pointset );


    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );

    container = document.getElementById( 'container' );
    container.appendChild( renderer.domElement );
    
    animate();
    render();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
}

function render() {
    renderer.render( scene, camera );
}

function onChangeVertices() {
    vertices.needsUpdate = true;
    render();
}


function animate() {
    requestAnimationFrame( animate );
    controls.update();
}