/**
 * @author Jimmy Andrews / jimmylands.com
 * 
 * For filling the gap between my js wrapper of voro++ and three.js
 */

// e.g. call with
// v3 = new Voro3([-10, -10, -10], [10, 10, 10]);
// you MUST CALL v3.delete() if/when you're done using the object but want to stay on the same page to tell the c++ module to free memory

Voro3 = function (min_point, max_point) {
    
    var _this = this;
    
    
    this.est_max_preview_verts = 1024;
    this.est_max_tris = 32768;
    
    this.add_to_scene = function(scene) {
        if (this.preview_lines) {
            scene.add(this.preview_lines);
        }
        if (this.mesh) {
            scene.add(this.mesh);
        }
    };
    
    
    this.generate = function(scene, min_point, max_point, generator_fn, numPts, seed, fill_level) {
        this.min_point = min_point;
        this.max_point = max_point;
        
        Math.seedrandom(seed);
        if (this.voro) {
            this.voro.delete();
        }
        this.voro = new Module.Voro(this.min_point,this.max_point);
        generator_fn(numPts, this.voro);
        if (fill_level == 0) {
            this.voro.set_only_centermost(1,0);
        } else {
            this.voro.set_fill(fill_level/100.0, Math.random()*2147483648);
        }
        
        this.geometry = this.init_geometry(this.est_max_tris);
        this.material = new THREE.MeshPhongMaterial( { color: 0xaaaaaa, specular: 0x111111, shininess: 5, shading: THREE.FlatShading } ) ;
        //    material = new THREE.MeshBasicMaterial( { color: 0xffffff, wireframe: true } ) ;
        if (this.mesh) {
            scene.remove(this.mesh);
        }
        this.mesh = new THREE.Mesh( this.geometry, this.material );
        
        this.preview_geometry = this.init_preview(this.est_max_preview_verts);
        this.preview_material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: .5, transparent: false } );
        this.preview_lines = new THREE.LineSegments(this.preview_geometry, this.preview_material);
        this.preview_lines.visible = false;
        
        this.add_to_scene(scene);
    };
    
    this.alloc_geometry = function(geometry) {
        this.verts_ptr = this.voro.gl_vertices();
        var max_tris = this.voro.gl_max_tris();
        var array = Module.HEAPF32.subarray(this.verts_ptr/4, this.verts_ptr/4 + max_tris*3*3);
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    }
    this.init_geometry = function(est_max_tris) {
        var geometry = new THREE.BufferGeometry();
        var max_tris = est_max_tris;
        this.voro.gl_build(max_tris /* initial guess at num tris needed */);
        this.alloc_geometry(geometry);
        geometry.name = 'voro3';
        var num_tris = this.voro.gl_tri_count();
        geometry.setDrawRange(0, num_tris*3);
        return geometry;
    };
    this.realloc_geometry = function() {
        this.geometry.removeAttribute('position');
        this.alloc_geometry(this.geometry);
    }
    
    this.alloc_preview = function(geometry) {
        this.preview_verts_ptr = this.voro.gl_single_cell_vertices();
        var verts_ptr = this.preview_verts_ptr; // just to give it a shorter name
        var max_verts = this.voro.gl_single_cell_max_verts();
        var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_verts*3);
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    }
    this.init_preview = function(est_max_preview_verts) {
        var geometry = new THREE.BufferGeometry();
        var max_verts = est_max_preview_verts;
        this.voro.gl_single_build(max_verts);
        this.alloc_preview(geometry);
        geometry.name = 'voro3_preview';
        var num_verts = this.voro.gl_single_cell_vert_count();
        geometry.setDrawRange(0, num_verts);
        return geometry;
    };
    this.realloc_preview = function() {
        this.preview_geometry.removeAttribute('position');
        this.alloc_preview(this.preview_geometry);
    }
    
    this.add_cell = function (pt_3, state=true) {
        var pt = [pt_3.x, pt_3.y, pt_3.z];
        var cell = this.voro.add_cell(pt, state);
        this.update_geometry();
        return cell;
    };
    this.move_cell = function(cell, pt_arr) {
        this.voro.move_cell(cell, pt_arr);
        this.update_geometry();
    };
    this.update_geometry = function () {
        var num_tris = this.voro.gl_tri_count();
        var current_verts_ptr = this.voro.gl_vertices();
        if (current_verts_ptr != this.verts_ptr) {
            this.realloc_geometry();
        }
        this.geometry.setDrawRange(0, num_tris*3);
        this.geometry.attributes['position'].needsUpdate = true;
    };
    this.update_preview = function() {
        var num_verts = this.voro.gl_single_cell_vert_count();
        var current_verts_ptr = this.voro.gl_single_cell_vertices();
        if (current_verts_ptr != this.preview_verts_ptr) {
            this.realloc_preview();
        }
        this.preview_geometry.setDrawRange(0, num_verts);
        this.preview_geometry.attributes['position'].needsUpdate = true;
    };
    this.raycast_vertex_index = function(mouse, camera, caster) {
        caster.setFromCamera(mouse, camera);

        var intersects = caster.intersectObject(this.mesh);
        if (intersects.length === 0)
            return -1;
        
        var intersect = intersects[0];
        return intersect.index;
    };

    this.raycast_pt = function(mouse, camera, caster) {
        caster.setFromCamera(mouse, camera);
        
        var intersects = caster.intersectObject(this.mesh);
        if (intersects.length === 0)
            return null;
        
        var intersect = intersects[0];
        return intersect.point;
    };
    this.raycast = function(mouse, camera, caster) {
        index = this.raycast_vertex_index(mouse, camera, caster)
        if (index < 0)
            return index;
        
        return this.voro.cell_from_vertex(index)
    };
    this.raycast_neighbor = function(mouse, camera, caster) {
        index = this.raycast_vertex_index(mouse, camera, caster)
        if (index < 0)
            return index;
        
        return this.voro.cell_neighbor_from_vertex(index)
    };

    this.set_preview = function(cell) {
        if (cell < 0) {
            this.preview_lines.visible = false;
            return;
        }
        this.voro.gl_compute_single_cell(cell);
        this.update_preview();
        this.preview_lines.visible = true;
    };
    

    this.toggle_cell = function(cell) {
        this.voro.toggle_cell(cell);
        this.update_geometry();
    };

    this.delete_cell = function(cell) {
        this.voro.delete_cell(cell);
        this.update_geometry();
    };
    this.cell_pos = function(cell) {
        return this.voro.cell_pos(cell);
    };
    this.sanity = function(name = "unlabelled sanity check") {
        return this.voro.sanity(name)
    };

    this.delete = function() {
        this.voro.delete();
    };





    // Chaos functions are part of sanity checking / debugging code
    
    this.doChaos = function() {
        var chaos_limit = 1000;
        if (chaos_limit == null || chaos_limit-- > 0) {
            var choice = Math.random()*4;
            if (Math.floor(choice) === 0) {
                var cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
            }
            else if (Math.floor(choice) === 1) {
                this.voro.delete_cell(0);
                var cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                var cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                var cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
            } else if (Math.floor(choice) === 2) {
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([1,1,1], true);
                this.voro.add_cell([1+Math.random()*.001,1+Math.random()*.001,1+Math.random()*.001], true);
                this.voro.add_cell([0,Math.random()*.1-.05,0], true);
                this.voro.add_cell([0,Math.random()*1000-500,0], true);
            } else {
                this.voro.move_cell(Math.random()*this.voro.cell_count(),[Math.random()*20-10,Math.random()*20-10,Math.random()*20-10]);
                this.voro.move_cell(Math.random()*this.voro.cell_count(),[0,Math.random()*1000-500,0]);
                this.voro.move_cell(0,[0,Math.random()*40-20,0]);
                var pos = [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10];
                var cell = this.voro.add_cell(pos, true);
                this.voro.move_cell(cell,pos);
                pos[0] += .01;
                this.voro.move_cell(cell,pos);
            }
            v3.update_geometry();
        }

        // if we're done, check sanity
        if (chaos_limit !== null && chaos_limit === 0) {
            console.log("chaos over -- checking sanity at end ...");
            var sanity = v3.sanity("after chaos");
            console.log("sanity = " + sanity);
        }
    }
}

Voro3.prototype.constructor = Voro3;