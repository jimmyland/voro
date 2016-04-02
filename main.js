// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

var scene, camera, renderer;
var geometry, material, mesh;
var vertices, offset;


function init() {

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 10;
    
    geometry = new THREE.BufferGeometry();
    // create a simple square shape. We duplicate the top left and bottom right
    // vertices because each vertex needs to appear once per triangle.
    var vertexPositions = [
                           [-1.0, -1.0,  1.0],
                           [ 1.0, -1.0,  1.0],
                           [ 1.0,  1.0,  1.0],
                           
                           [ 1.0,  1.0,  1.0],
                           [-1.0,  1.0,  1.0],
                           [-1.0, -1.0,  1.0]
                           ];
    offset = _malloc(6 * 4 * 3);
    var array = Module.HEAPF32.subarray(offset/4, offset/4 + 18);
    vertices = new THREE.BufferAttribute( array, 3 );
    //vertices = new THREE.BufferAttribute( new Float32Array(6*3), 3 )
    

    // components of the position vector for each vertex are stored
    // contiguously in the buffer.
    var j=0;
    for ( var i = 0; i < vertexPositions.length; i++ )
    {
       vertices.array[j++] = vertexPositions[i][0];
       vertices.array[j++] = vertexPositions[i][1];
       vertices.array[j++] = vertexPositions[i][2];
    }
    

    // itemSize = 3 because there are 3 values (components) per vertex
    geometry.addAttribute( 'position', vertices );

    material = new THREE.MeshBasicMaterial( { color: 0xff0000 } );
    mesh = new THREE.Mesh( geometry, material );

    //geometry = new THREE.BoxGeometry( 200, 200, 200 );
    //material = new THREE.MeshBasicMaterial( { color: 0xff0000, wireframe: true } );

    //mesh = new THREE.Mesh( geometry, material );
    scene.add( mesh );

    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );

    document.body.appendChild( renderer.domElement );
    
    animate();

}

function animate() {

    requestAnimationFrame( animate );
    
    renderer.render( scene, camera );
    //vertices.array[0] += .1;
    //vertices.array[3] = .5
    _randomPoints(1, offset+3*4*1);
    vertices.needsUpdate = true;
}