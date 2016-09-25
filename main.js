// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example
/* global THREE, Detector, saveAs, fromByteArray, toByteArray, $, ready_for_emscripten_calls, Voro3 */
/*jshint -W008 */
/*jslint devel: true, indent: 4, maxerr: 50 */
"use strict";

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var lights;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();


var controls;
var last_touch_for_camera = false;
function override_cam_controls() { // disable trackball controls
    controls.overrideState();
    controls.dragEnabled = false;
    last_touch_for_camera = false;
}

function hexToRGBFloat(hex) {
    var bigint = parseInt(hex.slice(1), 16);
    var r = (bigint >> 16) & 255;
    var g = (bigint >> 8) & 255;
    var b = bigint & 255;
    return [r/255.0, g/255.0, b/255.0];
}

function convertPalette() {
    var pal = $("#showPalette").spectrum("option", "palette");
    var res = [];
    for (var outer=0; outer<pal.length; outer++) {
        for (var inner=0; inner<pal[outer].length; inner++) {
            res.push(hexToRGBFloat(pal[outer][inner]));
        }
    }
    return res;
}

var v3;
var xf_manager;
var undo_q;

var settings;

var UndoAct = function(prev_sel_inds, post_sel_inds, voro_act_seq) {
    var prev_sel_ids = v3.inds_to_ids(prev_sel_inds);
    var post_sel_ids = v3.inds_to_ids(post_sel_inds);
    this.redo = function(v3, xfm) {
        v3.redo(voro_act_seq);
        v3.update_geometry();

        var sel_inds = v3.ids_to_inds(post_sel_ids);
        xfm.attach(sel_inds, true);
    };
    this.undo = function(v3, xfm) {
        v3.undo(voro_act_seq);
        v3.update_geometry();

        var sel_inds = v3.ids_to_inds(prev_sel_ids);
        xfm.attach(sel_inds, true);
    };
    this.get_sel_inds = function() {
        return v3.ids_to_inds(post_sel_ids);
    };
};
var UndoQueue = function() {
    this.undo_queue = [];
    this.undo_queue_posn = -1;
    this.clear = function() {
        this.undo_queue = [];
        this.undo_queue_posn = -1;
    };
    this.undo = function() {
        if (this.undo_queue.length > 0 && this.undo_queue_posn >= 0) {
            var action = this.undo_queue[this.undo_queue_posn];
            this.undo_queue_posn -= 1;
            action.undo(v3, xf_manager);
        }
        v3.update_geometry();
    };
    this.redo = function() {
        if (this.undo_queue_posn+1 < this.undo_queue.length) {
            this.undo_queue_posn += 1;
            var action = this.undo_queue[this.undo_queue_posn];
            action.redo(v3, xf_manager);
        }
        v3.update_geometry();
    };
    this.add_undoable = function(undoable) {
        this.undo_queue = this.undo_queue.slice(0, this.undo_queue_posn+1);
        this.undo_queue.push(undoable);
        this.undo_queue_posn += 1;
    };
    this.get_top_sel_inds = function() { // helper to get the selection at the top of the undo queue
        if (this.undo_queue_posn < 0) {
            return [];
        } else {
            return this.undo_queue[this.undo_queue_posn].get_sel_inds();
        }
    };
};


//camera, renderer.domElement
var XFManager = function (scene, camera, domEl, v3, override_other_controls) {
    this.controls = undefined;
    this.max_points = 1000; // an initial buffer size; can expand as needed by re-allocating
    var _this = this;

    this.init_geom = function() {
        // init geom, mat, pts, positions to represent a point cloud w/ no points initially
        this.geom = new THREE.Geometry();
        this.positions = new Float32Array(this.max_points*3);
        this.mat = new THREE.PointsMaterial( { size: 0.2, color: 0x00ffff, depthTest: false, depthWrite: false } );
        this.mat.visible = false;
        this.pts = new THREE.Points(this.geom, this.mat);
        this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,0,0), 100000); // just make it huge; we don't care about the bounding sphere.
        this.scene.add(this.pts);
        this.pts.renderOrder = 1;
    };

    this.reset = function() {
        this.cells = [];
        this.plane = this.mouse_offset = undefined;

        this.mat.visible = false;
        this.controls.detach();
    };

    this.init = function(scene, camera, domEl, v3, override_other_controls) {
        this.v3 = v3;
        this.scene = scene;
        this.camera = camera;
        this.domEl = domEl;
        this.controls = new THREE.TransformControls(camera, domEl);
        this.controls.addEventListener('objectChange', this.handle_moved); //moved_control
        this.controls.addEventListener('mouseDown', override_other_controls); //e.g. steal from camera
        this.controls.setSpace("world");
        this.scene.add(this.controls);
        this.init_geom();
        this.reset();
    };

    this.update = function() {
        if (this.controls) this.controls.update();
    };

    this.update_previews = function() {
        this.v3.clear_preview();
        for (var i=0; i<this.cells.length; i++) {
            if (this.cells.length > 1 || this.v3.cell_type(this.cells[i]) === 0) {
                this.v3.add_preview(this.cells[i]);
            }
        }
        this.v3.update_preview();
    };

    this.keydown = function(event) {
        if (event.keyCode === 27) {
            this.deselect();
        }
        
        if (this.controls.visible) {
            if (event.keyCode === 'W'.charCodeAt()) {
                this.controls.setMode("translate");
            }
            if (event.keyCode === 'E'.charCodeAt()) {
                this.controls.setMode("rotate");
            }
            if (event.keyCode === 'R'.charCodeAt()) {
                this.controls.setMode("scale");
            }
        }
    };

    this.handle_moved = function() {
        _this.move_cells();
        _this.update_previews();
        render();
    };

    this.detach = function() { if (this.controls) this.controls.detach(); };
    this.invis = function() { if (this.mat) this.mat.visible = false; };
    this.stop_custom = function() { this.plane = null; };

    this.deselect = function() {
        this.cells = [];
        this.detach();
        this.invis();
    };

    this.over_axis = function() { return this.controls && this.controls.axis; };
    this.dragging = function() { return this.controls && this.controls.visible && this.controls._dragging; };
    this.dragging_custom = function() { return this.mat && this.plane; };
    this.active = function() { return this.cells.length > 0 && this.mat && this.plane; };

    this.drag_custom = function(mouse) {
        if (this.controls) {
            this.controls.axis = null; // make sure the transformcontrols are not active when the custom drag controls are active
        }

        var pos = mouse.clone().add(this.mouse_offset);
        var caster = new THREE.Raycaster();
        caster.setFromCamera(pos, this.camera);
        
        var endpt = new THREE.Vector3();
        endpt.copy(caster.ray.direction);
        endpt.multiplyScalar(1000);
        endpt.add(caster.ray.origin);
        
        var rayline = new THREE.Line3(caster.ray.origin, endpt);
        var newpos = this.plane.intersectLine(rayline);
        if (newpos && this.cells.length > 0) {
            this.pts.position.set(newpos.x, newpos.y, newpos.z);
            this.move_cells();
            this.update_previews();
        }
    };

    this.move_cells = function() { // assume this.cells is 1:1 w/ the points in this.geom
        this.pts.updateMatrixWorld();
        var p = this.positions;
        var v = new THREE.Vector3();
        var posns = [];
        for (var i=0; i<this.cells.length; i++) {
            v.set(p[i*3],p[i*3+1],p[i*3+2]);
            v.applyMatrix4(this.pts.matrixWorld);
            posns.push([v.x,v.y,v.z]);
        }
        this.v3.move_cells(this.cells, posns);
    };

    this.set_geom_multi = function(cells) {
        // if there's nothing, just hide everything
        if (!cells || cells.length === 0) {
            this.invis();
            return;
        }

        // re-alloc verts if needed
        if (cells.length > this.max_points) {
            this.max_points = Math.max(this.max_points*2, cells.length);
            this.positions = new Float32Array(this.max_points*3);
        }
        // reset all transforms; we'll rebuild attachments from scratch
        this.pts.scale.set(1,1,1);
        this.pts.quaternion.set(0,0,0,1);
        this.pts.updateMatrix();
        this.pts.updateMatrixWorld(true);

        // set the cell positions
        var center = [0,0,0];
        var p0 = this.v3.cell_pos(cells[0]);
        center = p0; // center at p0 for now; todo: revisit where the center of the selection should be?  1st cell clicked OR centroid of cells OR other?
        this.positions[0] = 0; this.positions[1] = 0; this.positions[2] = 0;
        for (var i=1; i<cells.length; i++) {
            var pi = this.v3.cell_pos(this.cells[i]);
            this.positions[i*3+0] = pi[0]-center[0];
            this.positions[i*3+1] = pi[1]-center[1];
            this.positions[i*3+2] = pi[2]-center[2];
        }

        // position and hook up the whole pointcloud
        this.pts.position.set(center[0], center[1], center[2]);
        this.controls.attach(this.pts);
    };

    this.attach = function(cells, skip_setting_plane) {
        this.cells = cells;
        if (this.cells.length > 0 && this.cells[0] >= 0) {
            if (!skip_setting_plane) {
                var n = camera.getWorldDirection();
                var p = new THREE.Vector3().fromArray(this.v3.cell_pos(this.cells[0]));
                this.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
                var p_on_screen = p.project(camera);
                this.mouse_offset = p_on_screen.sub(mouse);
            }
            this.set_geom_multi(cells);
            render();
            this.update_previews();
        } else {
            this.deselect();
            this.update_previews();
        }
    };

    this.init(scene, camera, domEl, v3, override_other_controls);
};



var Generators = {
    "Random": function(numpts, voro) {
        voro.add_cell([0,0,0], true);
        for (var i=0; i<numpts-1; i++) {
            voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], false);
        }
        
    },
    "Cubes": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts));
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
                    voro.add_cell([i*2*w/n-w+Math.random()*r,j*2*w/n-w+Math.random()*r,k*2*w/n-w+Math.random()*r], (i+j+k)%2===1);
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
                    voro.add_cell([r*Math.cos(theta)+Math.random()*jitter, r*Math.sin(theta)+Math.random()*jitter, z+Math.random()*jitter], ((zi%n)-ti)===0);
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
    },
    "Hexagonal Prisms": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts));
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                var offset = (j%2)*(w/n);
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w+offset], (i+j+k)%2==1);
                }
            }
        }
    },
    "Triangular Prisms": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/2));
        var o = (w/n);
        for (var i=0; i<2*n+1; i++) {
            var s = i%4;
            var ox = (s===0||s===1)?0:o;
            var oz = (i%2)*o*.5-o*.25;
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*w/n-w+oz,j*2*w/n-w+ox,k*2*w/n-w], (i+j+k)%2===1);
                }
            }
        }
    },
    "Truncated Octahedra": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/2));
        var o = (w/n);
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w], (i+j+k)%2===1);
                    voro.add_cell([i*2*w/n-w+o,j*2*w/n-w+o,k*2*w/n-w+o], (i+j+k)%2===1);
                }
            }
        }
    },
    "Gyrobifastigia": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/2));
        var o = (w/n);
        for (var i=0; i<2*n+1; i++) {
            var s = i%4;
            var ox = (s===0||s===1)?0:o;
            var oy = (s===0||s===3)?0:o;
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*w/n-w,j*2*w/n-w+ox,k*2*w/n-w+oy], (i+j+k)%2===1);
                }
            }
        }
    },
    "Rhombic Dodecahedra": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/4));
        var o = (w/n);
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w+o,j*2*w/n-w+o,k*2*w/n-w], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w+o,j*2*w/n-w,k*2*w/n-w+o], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w+o,k*2*w/n-w+o], (i+j+k)%2==1);
                }
            }
        }
    },
    "Elongated Dodecahedra": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/4));
        var o = (w/n);
        for (var i=0; i<n+1; i++) {
            var oxy = (i%2)*o;
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w+oxy,k*2*w/n-w+oxy], (i+j+k)%2==1);
                }
            }
        }
    },
    "Cubes with Pillows": function(numpts, voro) {
        var w = 9.9;
        var n = Math.floor(Math.cbrt(numpts/4));
        var o = (w/n);
        for (var i=0; i<n+1; i++) {
            for (var j=0; j<n+1; j++) {
                for (var k=0; k<n+1; k++) {
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w+o,j*2*w/n-w,k*2*w/n-w], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w+o,k*2*w/n-w], (i+j+k)%2==1);
                    voro.add_cell([i*2*w/n-w,j*2*w/n-w,k*2*w/n-w+o], (i+j+k)%2==1);
                }
            }
        }
    }
};

var VoroSettings = function() {
    this.mode = 'move';
    // this.generator = 'uniform random';
    this.generator = 'Gyrobifastigia';
    this.numpts = 1000;
    this.seed = 'qq';
    this.fill_level = 0.0;
    this.symmetry_type = 'Dihedral';
    this.symmetry_param = 3;
    this.siteScale = 1;
    this.toggleSites = function() {
        v3.sites_points.visible = !v3.sites_points.visible;
        render();
    };
    this.set_colors_from_form = function (f) {
        enable_color("color" in f);
    };
    this.set_sites_from_form = function(f) {
        v3.sites_points.visible = 'show' in f;
        this.siteScale = f.sites_scale;
        render();
    };
    this.symmetrify = function() {
        var fmap = {Mirror: v3.symmetries.Mirror, Rotational: v3.symmetries.Rotational, 
                    Scale: v3.symmetries.Scale, Dihedral: v3.symmetries.Dihedral};
        v3.enable_symmetry(new fmap[this.symmetry_type](this.symmetry_param));
        xf_manager.reset();
        addToUndoQIfNeeded();
    };
    this.symmetrify_from_form = function(vals) {
        var fmap = {Mirror: v3.symmetries.Mirror, Rotational: v3.symmetries.Rotational, 
                    Scale: v3.symmetries.Scale, Dihedral: v3.symmetries.Dihedral};
        v3.enable_symmetry(new fmap[vals.symmetry_mode](vals.sym_param));
        xf_manager.reset();
        addToUndoQIfNeeded();
    };
    this.bake_symmetry = function() {
        v3.bake_symmetry();
        xf_manager.reset();
        addToUndoQIfNeeded();
    };
    
    this.regenerate = function(has_color) {
        xf_manager.reset();
        v3.generate(scene, [-10, -10, -10], [10, 10, 10], Generators[this.generator], this.numpts, this.seed, this.fill_level);
        render();
        enable_color(has_color);
        undo_q.clear();
        render();
    };

    this.generate_from_form = function(values) {
        this.generator = values.generator;
        this.numpts = values.numpts;
        this.seed = values.seed;
        this.regenerate("color" in values);
    };

    this.filename = 'filename';
    this.exportAsSTL = function() {
        var binstl = v3.get_binary_stl_buffer();
        var blob = new Blob([binstl], {type: 'application/octet-binary'});
        saveAs(blob, this.filename + ".stl");
    };
    this.downloadRaw = function() {
        var bin = v3.get_binary_raw_buffer();
        var blob = new Blob([bin], {type: 'application/octet-binary'});
        saveAs(blob, this.filename + ".vor");
    };
    this.uploadRaw = function() {
        document.getElementById('upload_raw').addEventListener('change', loadRawVoroFile, false);
        $("#upload_raw").trigger('click');
        return false;
    };
    this.save = function() {
        var bin = v3.get_binary_raw_buffer();
        var binstr = fromByteArray(new Uint8Array(bin));
        localStorage.setItem("saved_cells", binstr);
    };
    this.load = function() {
        var binstr = localStorage.getItem("saved_cells");
        if (binstr !== null) {
            var bin = toByteArray(binstr).buffer;
            xf_manager.reset();
            var valid = v3.generate_from_buffer(scene, bin);
            if (!valid) {
                alert("Failed to load the saved voronoi diagram!  It might not have saved correctly, or there might be a bug in the loader!");
            } else {
                enable_color(v3.palette_length() > 0);
                undo_q.clear();
            }
        }
    };

};

function loadRawVoroFile(evt) {
    var files = evt.target.files;

    if (files.length > 0) {
        var reader = new FileReader();
        reader.onload = function(event) {
            xf_manager.reset();
            var valid = v3.generate_from_buffer(scene, event.target.result);
            if (!valid) {
                alert("Failed to load this voronoi diagram! It might not be a valid voronoi diagram file, or it might have been corrupted, or there might be a bug in file saving/loading!");
            } else {
                enable_color(v3.palette_length() > 0);
                undo_q.clear();
            }
        };
        reader.readAsArrayBuffer(files[0]);
    }
    document.getElementById('upload_raw').value = null;
}



function wait_for_ready() {
    if (ready_for_emscripten_calls) {
        init();
    } else {
        requestAnimationFrame( wait_for_ready );
    }
}
$(document).ready( function() {
    wait_for_ready();
});


function clear_lights() {
    if (lights) {
        for (var i=0; i<lights.length; i++) {
            scene.remove(lights[i]);
        }
        lights = [];
    }
}

var LightPresets = {
    "Axis Colors": function() {
        var l = [];
        l[0] = new THREE.DirectionalLight( 0xcc9999 );
        l[1] = new THREE.DirectionalLight( 0x99cc99 );
        l[2] = new THREE.DirectionalLight( 0x9999cc );
        
        l[3] = new THREE.DirectionalLight( 0xff9999 );
        l[4] = new THREE.DirectionalLight( 0x99ff99 );
        l[5] = new THREE.DirectionalLight( 0x9999ff );
        
        l[0].position.set( 0, 1, 0 );
        l[1].position.set( 1, 0, 0 );
        l[2].position.set( 0, 0, 1 );
        l[3].position.set( 0,-1, 0 );
        l[4].position.set(-1, 0, 0 );
        l[5].position.set( 0, 0,-1 );
        return l;
    },
    "Plain Three Light": function() {
        var l = [];
        l[0] = new THREE.DirectionalLight( 0x888888 );
        l[1] = new THREE.DirectionalLight( 0x888888 );
        l[2] = new THREE.AmbientLight( 0xdddddd );
        
        l[0].position.set(  1, .1,-.1 );
        l[1].position.set( .1,-.1,  1 );
        return l;
    },
    "Solid Color with No Shading": function() {
        var l = [new THREE.AmbientLight( 0xffffff )]; 
        l[0].intensity = 1.5;
        return l;
    }
};

function set_lights(light_preset_name) {
    clear_lights();

    lights = LightPresets[light_preset_name]();

    for (var i=0; i<lights.length; i++) {
        scene.add(lights[i]);
    }
}

function setup_scene() {
    if (v3) {
        v3.nuke(scene);
    }
    
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 30;

    v3 = new Voro3();
    undo_q = new UndoQueue();
    
    set_lights("Plain Three Light");
    
    var bb_geom = new THREE.BoxGeometry( 20, 20, 20 );
    var bb_mat = new THREE.MeshBasicMaterial( { wireframe: true } );
    var bounding_box_mesh = new THREE.Mesh( bb_geom, bb_mat );
    var bb_edges = new THREE.EdgesHelper(bounding_box_mesh);
    scene.add(bb_edges);

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

    xf_manager = new XFManager(scene, camera, renderer.domElement, v3, override_cam_controls);
}

function focusOver() {
    $('#container').focus();
}

function init() {
    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );
    var container = document.getElementById( 'container' );
    container.addEventListener( 'mousemove', onDocumentMouseMove, false );
    container.addEventListener( 'touchstart', onDocumentTouchStart, false );
    container.addEventListener( 'touchmove', onDocumentTouchMove, false );
    container.addEventListener( 'touchend', onDocumentTouchEnd, false );
    container.addEventListener( 'mousedown', onDocumentMouseDown, false );
    container.addEventListener( 'keydown', onDocumentKeyDown, false );
    container.addEventListener( 'mouseup', onDocumentMouseUp, false );
    container.addEventListener( 'mouseover', focusOver, false );

    
    container.appendChild( renderer.domElement );
    
    settings = new VoroSettings();    
    setup_scene();
    settings.regenerate(true);
    
    animate();
    render();
}


function enable_color(yes) {
    if (yes) {
        v3.set_palette(convertPalette());
        $("#color-tools").show();
    } else {
        v3.set_palette([]);
        $("#color-tools").hide();
    }
}


function onDocumentKeyDown( event ) {
    addToUndoQIfNeeded();
    if (event.keyCode == "Z".charCodeAt() && (event.ctrlKey || event.metaKey)) {
        if (event.shiftKey) {
            undo_q.redo();
        } else {
            undo_q.undo();
        }
    }
    
    xf_manager.keydown(event);
    // not sure this feature was actually useful ...
    // if (event.keyCode >= 'X'.charCodeAt() && event.keyCode <= 'Z'.charCodeAt()) {
    //     var axis = event.keyCode - 'X'.charCodeAt();
    //     controls.alignToAxis(axis);
    //     xf_manager.deselect();
    // }

    // if the keypresses did anything worthy of the undo Q, ensure it's captured seprately.
    addToUndoQIfNeeded();

    render();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
    render();
}



function doToggleClick(button, mouse) {
    if (settings.mode === 'toggle' || settings.mode === 'toggle off') {
        xf_manager.deselect();
        var cell;
        if (button === 2 || settings.mode === 'toggle off') {
            cell = v3.raycast(mouse, camera, raycaster);
            v3.toggle_cell(cell);
        } else {
            cell = v3.raycast_neighbor(mouse, camera, raycaster);
            v3.toggle_cell(cell);
        }

        v3.set_preview(-1);
        // v3.set_preview(nbr_cell); // un-comment to make the next toggle preview pop up right away ... it's more responsive but feels worse to me.
    }
}

function doPaintClickOrMove(buttons, mouse) {
    if (!xf_manager.over_axis() && !controls.isActive()) {
        if (buttons && settings.mode === 'paint') {
            xf_manager.deselect();
            var cell = v3.raycast(mouse, camera, raycaster);
            if (cell > -1 && v3.cell_type(cell) !== v3.active_type) {
                v3.set_cell(cell, v3.active_type);
                v3.update_geometry();
                v3.set_preview(-1);
            }       
        }
    }
}

function addToUndoQIfNeeded() {
    var old_sel = undo_q.get_top_sel_inds();
    var selection_changed = function(old_sel, sel) {
        if (old_sel.length != sel.length) {
            return true;
        }
        for (var i=0; i<sel.length; i++) {
            if (sel[i] != old_sel[i]) {
                return true;
            }
        }
        return false;
    };
    if (v3.has_acts() || selection_changed(old_sel, xf_manager.cells)) {
        undo_q.add_undoable(new UndoAct(old_sel, xf_manager.cells, v3.pop_acts()));
    }
}

function doAddDelClick(button, mouse) {
    if (settings.mode === 'add/delete' || settings.mode === 'delete') {
        if (settings.mode === 'delete') {
            var cell;
            if (button === 2) {
                cell = v3.raycast_neighbor(mouse, camera, raycaster);
            } else {
                cell = v3.raycast(mouse, camera, raycaster);
            }
            v3.delete_cell(cell);
            xf_manager.deselect();
            v3.set_preview(-1);
        } else {
            var pt = v3.raycast_pt(mouse, camera, raycaster);
            if (pt) {
                pt = v3.bb_project(pt);
                var added_cell = v3.add_cell(pt, (button !== 2));
                xf_manager.attach([added_cell]);
            }
        }
    }
}

function startMove(mouse, extend_current_sel, nbr) {
    if (!xf_manager.active()) {
        if (settings.mode === 'move' || settings.mode === 'move neighbor') {
            var moving_cell_new;
            if (settings.mode === 'move') {
                moving_cell_new = v3.raycast(mouse, camera, raycaster);
                
            }
            if (settings.mode === 'move neighbor' || nbr) {
                moving_cell_new = v3.raycast_neighbor(mouse, camera, raycaster);
            }
            if (moving_cell_new < 0) {
                return;
            }

            var has_cell = false;
            for (var i=0; i<xf_manager.cells.length; i++) {
                has_cell = has_cell || (xf_manager.cells[i] === moving_cell_new);
            }

            var cells = [moving_cell_new];
            if (extend_current_sel || has_cell) {
                cells = xf_manager.cells;
                
                if (!has_cell) {
                    cells.push(moving_cell_new);
                }
            }
            xf_manager.attach(cells);
        }
    }
}

function set_cursor(cell_over) {
    if (cell_over === undefined) {
        cell_over = v3.raycast(mouse, camera, raycaster);
    }
    if (controls.isActive()) {
        renderer.domElement.style.cursor = "move";
    } else if (xf_manager.dragging() || xf_manager.dragging_custom()) {
        renderer.domElement.style.cursor = "move";
        renderer.domElement.style.cursor = "grabbing";
        renderer.domElement.style.cursor = "-moz-grabbing";
        renderer.domElement.style.cursor = "-webkit-grabbing";
    } else if (xf_manager.over_axis()) {
        renderer.domElement.style.cursor = "default";
    } else if (cell_over !== null && cell_over >= 0) {
        renderer.domElement.style.cursor = "pointer";
    } else {
        renderer.domElement.style.cursor = "move";
    }
}

function onDocumentMouseDown(event) {
    doToggleClick(event.button, mouse);
    doPaintClickOrMove(event.buttons, mouse);
    
    doAddDelClick(event.button, mouse);

    startMove(mouse, event.shiftKey, event.button===2);
    
    render();

    set_cursor();
}

// unused vector logging functions; helpful for debugging sometimes
// function logv2(s,v){
//     console.log(s + ": " + v.x + ", " + v.y);
// }
// function logv3(s,v){
//     console.log(s + ": " + v.x + ", " + v.y + ", " + v.z);
// }

function onDocumentMouseUp() {
    xf_manager.stop_custom();
    addToUndoQIfNeeded();

    set_cursor();
}

function onDocumentMouseMove( event ) {
    event.preventDefault();
    doCursorMove(event.clientX, event.clientY);
    doPaintClickOrMove(event.buttons, mouse);
    var over_moving_controls = xf_manager.over_axis();
    var cell_over = check_allow_trackball(over_moving_controls);
    set_cursor(cell_over);
    
}

function set_preview_hover() {
    var prev_cell;
    if (settings.mode === 'toggle') {
        prev_cell = v3.raycast_neighbor(mouse, camera, raycaster);
    } else if (settings.mode === 'paint' || settings.mode === 'toggle off') {
        prev_cell = v3.raycast(mouse, camera, raycaster);
        if (settings.mode === 'paint' && prev_cell > -1 && v3.cell_type(prev_cell) === v3.active_type) {
            prev_cell = -1; // paint would do nothing, so don't preview
        }
    }
    if (prev_cell !== undefined) {
        v3.set_preview(prev_cell);
    }
}

function check_allow_trackball(over_moving_controls) {
    if (over_moving_controls===undefined) over_moving_controls = xf_manager.over_axis();
    var cell = null;
    if (!xf_manager.dragging()) {
        cell = v3.raycast(mouse, camera, raycaster);
        if (!controls.isActive() || controls.isTouch()) {
            controls.dragEnabled = (cell < 0 || settings.mode === 'camera') && !over_moving_controls;
            if (!controls.dragEnabled) {
                set_preview_hover();
            }
        }
    }
    return cell;
}
function doCursorMove(cur_x, cur_y) {
    v3.set_preview(-1);
    
    mouse.x = ( cur_x / window.innerWidth ) * 2 - 1;
    mouse.y = - ( cur_y / window.innerHeight ) * 2 + 1;
    if (xf_manager.dragging_custom()) {
        xf_manager.drag_custom(mouse);
    }
    
    render();
}

function mouse_from_touch(event) {
    var cur_x = event.touches[0].clientX, cur_y = event.touches[0].clientY;
    mouse.x = ( cur_x / window.innerWidth ) * 2 - 1;
    mouse.y = - ( cur_y / window.innerHeight ) * 2 + 1;
}

function onDocumentTouchStart( event ) {
    event.preventDefault();

    mouse_from_touch(event);
    check_allow_trackball(xf_manager.controls.checkHover(event));
    doAddDelClick(event.button, mouse);
    
    startMove(mouse, false, false);

    if (!controls.dragEnabled) {
        doPaintClickOrMove(true, mouse);
    }

}
function onDocumentTouchMove( event ) {
    event.preventDefault();
    mouse_from_touch(event);
    doCursorMove(event.touches[0].clientX, event.touches[0].clientY);

    if (!controls.dragEnabled) {
        doPaintClickOrMove(true, mouse);
    }
}
function onDocumentTouchEnd( event ) {
    xf_manager.stop_custom();

    if (!controls.dragEnabled) {
        doToggleClick(event.button, mouse);
        doPaintClickOrMove(true, mouse);
        
        
    }

    event.preventDefault();
    addToUndoQIfNeeded();

}

function render() {
    xf_manager.update();
    v3.sites_material.uniforms.scale.value = settings.siteScale;
    renderer.render( scene, camera );
}

function animate() {  
    // v3.do_chaos();
    render();  
    controls.update();

    requestAnimationFrame( animate );
}



