/**
 * @author Jimmy Andrews / jimmylands.com
 * 
 * For filling the gap between my js wrapper of voro++ and three.js
 */
/* global THREE, Module, assert */
/*jshint -W008 */
/*jslint devel: true, indent: 4, maxerr: 50 */
"use strict";

// e.g. call with
// v3 = new Voro3([-10, -10, -10], [10, 10, 10]);
// you MUST CALL v3.delete() if/when you're done using the object but want to stay on the same page to tell the c++ module to free memory


var Voro3 = function () {
    
    this.est_max_preview_verts = 1024;
    this.est_max_tris = 32768;
    this.est_max_cell_sites = 10000;
    this.tracked_acts = [];
    this.action_tracking = false;
    var that = this;
    this.palette = [];
    this.active_type = 1;

    this.start_tracking = function(yes) {
        if (yes === undefined || yes) {
            this.action_tracking = true;
        } else {
            this.action_tracking = false;
        }
        this.tracked_acts = [];
    };

    this.inds_to_ids = function(inds) {
        var res = [];
        for (var i=0; i<inds.length; i++) {
            res.push(this.voro.stable_id(inds[i]));
        }
        return res;
    };
    this.ids_to_inds = function(ids) {
        var res = [];
        for (var i=0; i<ids.length; i++) {
            var ind = this.voro.index_from_id(ids[i]);
            if (ind >= 0) {
                res.push(ind);
            }
        }
        return res;
    };

    var AddAct = function(cells, pts, states) {
        var cell_ids = that.inds_to_ids(cells);
        this.redo = function() {
            for (var i=0; i<cell_ids.length; i++) {
                var cell_ind = that.voro.add_cell(pts[i], states[i]);
                that.voro.set_stable_id(cell_ind, cell_ids[i]);
            }
        };
        this.undo = function() {
            for (var i=0; i<cell_ids.length; i++) {
                var ind = that.voro.index_from_id(cell_ids[i]);
                that.voro.delete_cell(ind);
            }
        };
    };
    var DeleteAct = function(cells) {
        var in_cells = [];
        var pts = [];
        var states = [];
        for (var i=0; i<cells.length; i++) {
            if (cells[i] < 0) { continue; }
            var c = that.voro.cell(cells[i]);
            in_cells.push(cells[i]);
            pts.push(c.pos);
            states.push(c.type);
        }
        var add = new AddAct(in_cells, pts, states);
        this.undo = function() { add.redo(); };
        this.redo = function() { add.undo(); };
    };
    var ToggleAct = function(cells, active_type) {
        var cell_ids = that.inds_to_ids(cells);
        this.redo = function() {
            var inds = that.ids_to_inds(cell_ids);
            for (var i=0; i<inds.length; i++) {
                that.voro.toggle_cell(inds[i], active_type);
            }
        };
        this.undo = this.redo;
    };
    var SetCellAct = function(cells, states) {
        var cell_ids = that.inds_to_ids(cells);
        var old_states = [];
        for (var i=0; i<cells.length; i++) {
            old_states.push(that.voro.cell_type(cells[i]));
        }
        this.set = function(what_states) {
            var inds = that.ids_to_inds(cell_ids);
            for (var i=0; i<inds.length; i++) {
                that.voro.set_cell(inds[i], what_states[i]);
            }
        };
        this.undo = function() {
            this.set(old_states);
        };
        this.redo = function() {
            this.set(states);
        };
    };
    var MoveAct = function(cells, pts, old_pts) {
        var moves = {};
        this.update = function(cells, pts, old_pts) {
            var cell_ids = that.inds_to_ids(cells);
            for (var i=0; i<cell_ids.length; i++) {
                var id = cell_ids[i];
                if (id in moves) {
                    moves[id][0] = pts[i];
                } else {
                    moves[id] = [pts[i],old_pts[i]];
                }
            }
        };
        this.update(cells, pts, old_pts);
        
        this.redo = function() {
            for (var id in moves) {
                var ind = that.voro.index_from_id(parseInt(id));
                that.voro.move_cell(ind, moves[id][0]);
            }
        };
        this.undo = function() {
            for (var id in moves) {
                var ind = that.voro.index_from_id(parseInt(id));
                that.voro.move_cell(ind, moves[id][1]);
            }
        };
    };
    var SetSymAct = function(sym_op, sym_map) {
        var old_op = that.active_sym;
        var new_op = sym_op;
        var copy_map = function(map) { // clone symmetry map as deeply as needed (currently a shallow copy)
            var m = {};
            for (var k in map) {
                m[k] = map[k];
            }
            return m;
        };
        var new_map = copy_map(sym_map);
        var old_map = copy_map(that.sym_map);

        this.redo = function() {
            that.sym_map = copy_map(new_map);
            that.active_sym = new_op;
        };
        this.undo = function() {
            that.sym_map = copy_map(old_map);
            that.active_sym = old_op;
        };
    };
    var UpdateSymAct = function(add_ids, delete_ids) {
        var collect_values = function(ids) {
            var v = {};
            for (var i=0; i<ids.length; i++) {
                v[ids[i]] = that.sym_map[ids[i]];
            }
            return v;
        };
        var clean_ids = function(ids) {
            for (var i=0; i<ids.length; i++) {
                delete that.sym_map[ids[i]];
            }
        };
        var restore_values = function(vals) {
            for (var id in vals) {
                that.sym_map[id] = vals[id];
            }
        };
        var add_values = collect_values(add_ids);
        var delete_values = collect_values(delete_ids);
        this.undo = function() {
            restore_values(delete_values);
            clean_ids(add_ids);
        };
        this.redo = function() {
            clean_ids(delete_ids);
            restore_values(add_values);
        };
    };
    var StopGLAct = function() {
        this.undo = function() {
            that.voro.gl_build(that.est_max_tris, that.est_max_preview_verts, that.est_max_cell_sites);
        };
        this.redo = function() {
            that.voro.clear_gl();
        };
    };
    var StartGLAct = function() {
        this.redo = function() {
            that.voro.gl_build(that.est_max_tris, that.est_max_preview_verts, that.est_max_cell_sites);
        };
        this.undo = function() {
            that.voro.clear_gl();
        };
    };
    var SetPaletteAct = function(old_pal, new_pal) {
        this.set = function(pal) {
            that.palette = pal;
            that.voro.set_palette(pal);
            that.update_geometry();
        };
        this.redo = function() {
            this.set(new_pal);
        };
        this.undo = function() {
            this.set(old_pal);
        };
    };
    var SetActiveTypeAct = function(old_color, new_color) {
        this.redo = function() {
            that.active_type = new_color;
        };
        this.undo = function() {
            that.active_type = old_color;
        };
    };


    this.undo = function(seq) {
        for (var i=seq.length-1; i>=0; i--) {
            seq[i].undo(this);
        }
        assert(this.voro.gl_is_live());
    };
    this.redo = function(seq) {
        for (var i=0; i<seq.length; i++) {
            seq[i].redo(this);
        }
        assert(this.voro.gl_is_live());
    };

    this.pop_acts = function() { // retrieves and clears all accumulated actions (e.g. since last call to pop_acts)
        assert(this.action_tracking);
        var acts = this.tracked_acts;
        this.tracked_acts = [];
        return acts;
    };
    this.has_acts = function() {
        return this.tracked_acts.length > 0;
    };

    this.track_act = function(act) {
        if (this.action_tracking) {
            this.tracked_acts.push(act);
        }
    };
    this.set_palette = function(palette) {
        var act = new SetPaletteAct(this.palette, palette);
        this.track_act(act);
        act.redo();
    };
    this.palette_length = function() {
        return this.palette.length;
    };

    
    this.add_to_scene = function(scene) {
        if (this.preview_lines) {
            scene.add(this.preview_lines);
        }
        if (this.mesh) {
            scene.add(this.mesh);
        }
        if (this.sites_points) {
            scene.add(this.sites_points);
        }
    };
    
    this.create_voro = function(min_point, max_point) {
        this.min_point = min_point;
        this.max_point = max_point;
        if (this.voro) {
            this.voro.delete();
        }
        this.voro = new Module.Voro(this.min_point,this.max_point);
        this.sym_map = {};
        this.active_sym = null;
    };

    // takes and returns a THREE.Vector3 for historical reasons; projects it into the Voro's bounding box
    this.bb_project = function(pt) {
        var eps = .0001;
        var p = [pt.x, pt.y, pt.z];
        for (var i=0; i<3; i++) {
            if (p[i] < this.min_point[i] + eps) {
                p[i] = this.min_point[i] + eps;
            }
            if (p[i] > this.max_point[i] - eps) {
                p[i] = this.max_point[i] - eps;
            }
        }
        return new THREE.Vector3(p[0], p[1], p[2]);
    };
    
    this.generate = function(scene, min_point, max_point, generator_fn, numPts, seed, fill_level) {
        this.nuke(scene);
        this.create_voro(min_point, max_point);
        
        Math.seedrandom(seed);
        
        this.start_tracking(false);
        generator_fn(numPts, this.voro);
        if (fill_level === 0) {
            this.voro.set_only_centermost(1,0);
        } else {
            this.voro.set_fill(fill_level/100.0, Math.random()*2147483648);
        }
        
        this.create_gl_objects(scene);
        
        this.add_to_scene(scene);

        this.start_tracking();
    };

    this.generate_from_buffer = function(scene, buffer) {
        this.nuke(scene);
        var was_tracking = this.action_tracking;
        this.start_tracking(false);
        var valid = this.create_from_raw_buffer(buffer);
        if (!valid) {
            this.start_tracking(was_tracking);
            return false;
        }
        
        this.create_gl_objects(scene);
        
        this.add_to_scene(scene);

        this.start_tracking();

        return true;
    };

    // tries to destroy every trace of the current voronoi diagram
    this.nuke = function(scene) {
        if (scene) {
            scene.remove(this.mesh);
            scene.remove(this.preview_lines);
            scene.remove(this.sites_points);
        }
        if (this.geometry) {
            this.geometry.dispose();
            this.material.dispose();
            this.preview_geometry.dispose();
            this.preview_material.dispose();
            this.sites_geometry.dispose();
            this.sites_material.dispose();
        }
        if (this.voro) {
            this.voro.clear_all();
            this.voro.delete();
            this.voro = null;
        }
    };

    this.set_vertex_colors = function() {
        if (this.material) {
            if (this.voro.has_colors()) {
                this.material.vertexColors = THREE.VertexColors;
            } else {
                this.material.vertexColors = THREE.NoColors;
            }
            this.material.needsUpdate = true;
        }
    };

    this.create_gl_objects = function(scene) {
        this.geometry = this.init_geometry(this.est_max_tris, this.est_max_preview_verts, this.est_max_cell_sites);
        this.material = new THREE.MeshPhongMaterial( { vertexColors: THREE.NoColors, color: 0xaaaaaa, specular: 0x111111, shininess: 5, shading: THREE.FlatShading } ) ;
        this.set_vertex_colors();
        if (this.mesh) {
            scene.remove(this.mesh);
        }
        this.mesh = new THREE.Mesh( this.geometry, this.material );
        
        this.preview_geometry = this.init_preview();
        this.preview_material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 0.5, transparent: false } );
        if (this.preview_lines) {
            scene.remove(this.preview_lines);
        }
        this.preview_lines = new THREE.LineSegments(this.preview_geometry, this.preview_material);
        this.preview_lines.visible = false;

        this.sites_geometry = this.init_sites();
        var uniforms = {color: {value: new THREE.Color(0xffffff)}, scale: {value: 1}};
        this.sites_material = new THREE.ShaderMaterial( {
            uniforms:       uniforms,
            vertexShader:   document.getElementById( 'sites_vertshader' ).textContent,
            fragmentShader: document.getElementById( 'sites_fragshader' ).textContent,
            depthTest:      true,
            blending:       THREE.AdditiveBlending,
            transparent:    true
        });

        if (this.sites_points) {
            scene.remove(this.sites_points);
        }
        this.sites_points = new THREE.Points(this.sites_geometry, this.sites_material);
    };
    
    this.alloc_geometry = function(geometry, realloc_only) {
        this.verts_ptr = this.voro.gl_vertices();
        var max_tris = this.voro.gl_max_tris();
        var array = Module.HEAPF32.subarray(this.verts_ptr/4, this.verts_ptr/4 + max_tris*3*3);
        var want_colors = this.voro.has_colors();
        var colors_array;
        if (want_colors) {
            var colors_ptr = this.voro.gl_colors();
            colors_array = Module.HEAPF32.subarray(colors_ptr/4, colors_ptr/4 + max_tris*3*3);
        }
        if (realloc_only && array === this.cached_geometry_array && colors_array === this.cached_colors_array) {
            return;
        }
        if (this.cached_geometry_array || this.cached_colors_array) {
            geometry.dispose();
        }
        this.cached_colors_array = colors_array;
        this.cached_geometry_array = array;
        geometry.addAttribute('position', new THREE.BufferAttribute(array, 3));
        if (want_colors) {
            geometry.addAttribute('color', new THREE.BufferAttribute(colors_array, 3));

        } else {
            geometry.removeAttribute('color');
        }
        this.set_vertex_colors();
    };
    this.init_geometry = function(est_max_tris, est_max_preview_verts, est_max_cell_sites) {
        var geometry = new THREE.BufferGeometry();
        this.voro.gl_build(est_max_tris, est_max_preview_verts, est_max_cell_sites);
        this.alloc_geometry(geometry);
        geometry.name = 'voro3';
        var num_tris = this.voro.gl_tri_count();
        geometry.setDrawRange(0, num_tris*3);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();

        return geometry;
    };
    
    this.alloc_preview = function(geometry, realloc_only) {
        this.preview_verts_ptr = this.voro.gl_wire_vertices();
        var verts_ptr = this.preview_verts_ptr; // just to give it a shorter name
        var max_verts = this.voro.gl_wire_max_verts();
        var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_verts*3);
        if (realloc_only && array === this.cached_preview_array) {
            return;
        }
        if (this.cached_preview_array) {
            geometry.dispose();
        }
        this.cached_preview_array = array;
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    };
    this.init_preview = function() {
        var geometry = new THREE.BufferGeometry();
        this.alloc_preview(geometry);
        geometry.name = 'voro3_preview';
        var num_verts = this.voro.gl_wire_vert_count();
        geometry.setDrawRange(0, num_verts);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();
        return geometry;
    };

    this.alloc_sites = function(geometry, realloc_only) {
        this.sites_verts_ptr = this.voro.gl_cell_sites();
        var verts_ptr = this.sites_verts_ptr; // just to give it a shorter name
        var max_verts = this.voro.gl_max_sites();
        var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_verts*3);
        var sizes_ptr = this.voro.gl_cell_site_sizes();
        var sizes_array = Module.HEAPF32.subarray(sizes_ptr/4, sizes_ptr/4 + max_verts);
        if (realloc_only && array === this.cached_sites_array && sizes_array === this.caches_sites_sizes_array) {
            return;
        }
        if (this.cached_sites_array || this.caches_sites_sizes_array) {
            geometry.dispose();
        }
        this.cached_sites_array = array;
        this.caches_sites_sizes_array = sizes_array;
        var vertices = new THREE.BufferAttribute(array, 3);
        var sizes = new THREE.BufferAttribute(sizes_array, 1);
        geometry.addAttribute('position', vertices);
        geometry.addAttribute('size', sizes);
    };
    this.init_sites = function() {
        var geometry = new THREE.BufferGeometry();
        this.alloc_sites(geometry);
        geometry.name = 'voro3_sites';
        var num_verts = this.voro.cell_count();
        geometry.setDrawRange(0, num_verts);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();
        return geometry;
    };
    
    this.add_cell_list_noup = function (pt, state, skip_sym) {
        if (state === undefined) {
            state = this.active_type;
        }
        var cell = this.voro.add_cell(pt, state);
        if (this.active_sym) {
            if (!skip_sym) { // add extra points 
                this.make_sym_cell(this.sym_map, this.active_sym, cell);
                var cell_id = this.voro.stable_id(cell);
                this.track_act(new UpdateSymAct([cell_id].concat(this.sym_map[cell_id].linked), []));
            }
        }
        this.track_act(new AddAct([cell],[pt],[state]));
        return cell;
    };
    this.add_cell = function (pt_3, state) {
        if (state && typeof(state) === 'boolean') {
            state = this.active_type;
        }
        var pt = [pt_3.x, pt_3.y, pt_3.z];
        var c = this.add_cell_list_noup(pt, state);
        this.update_geometry();
        return c;
    };
    this.track_move = function(cells, pts) {
        // get the past positions for all pts
        var old_pts = [];
        for (var i=0; i<cells.length; i++) {
            old_pts.push(this.voro.cell_pos(cells[i]));
        }
        // if top of acts stack is move, update it
        var last_i = this.tracked_acts.length-1;
        if (last_i >= 0 && this.tracked_acts[last_i] instanceof MoveAct) {
            this.tracked_acts[last_i].update(cells, pts, old_pts);
        } else { // else add new moveact
            this.track_act(new MoveAct(cells, pts, old_pts));
        }
    };
    this.move_cell = function(cell, pt_arr) {
        this.move_cells([cell],[pt_arr]);
    };
    this.move_cells = function(cells, pts_arr) {
        if (this.active_sym) {
            var sym_cells = [];
            var sym_pts = [];
            var did_sym_for = {}; // if we already did the symmetry moves for a point, don't do them again.
            for (var i=0; i<cells.length; i++) {
                var cell = cells[i];
                var pid = this.get_sym_pid(cell);
                if (!(pid in did_sym_for)) {
                    var slist = this.ordered_sym_list(cell);
                    var p = pts_arr[i];
                    sym_pts.push(p);
                    sym_cells.push(cell);
                    for (var ii=0; ii<slist[0].length; ii++) {
                        p = this.active_sym.op(p, slist[1]+ii);
                        var index_to_add = this.voro.index_from_id(slist[0][ii]);
                        sym_pts.push(p);
                        sym_cells.push(index_to_add);
                    }
                    did_sym_for[pid] = true;
                }
            }
            cells = sym_cells;
            pts_arr = sym_pts;
        }
        this.track_move(cells, pts_arr);
        this.voro.move_cells(cells, pts_arr);
        this.update_geometry();
    };
    this.update_sites = function() {
        var num_sites = this.voro.cell_count();
        this.alloc_sites(this.sites_geometry, true);
        this.sites_geometry.setDrawRange(0, num_sites);
        this.sites_geometry.attributes.position.needsUpdate = true;
        this.sites_geometry.attributes.size.needsUpdate = true;
    };
    this.update_geometry = function () {
        var num_tris = this.voro.gl_tri_count();
        this.alloc_geometry(this.geometry, true);
        this.geometry.setDrawRange(0, num_tris*3);
        this.geometry.attributes.position.needsUpdate = true;
        this.update_sites();
    };
    this.update_preview = function() {
        var num_verts = this.voro.gl_wire_vert_count();
        this.alloc_preview(this.preview_geometry, true);
        this.preview_geometry.setDrawRange(0, num_verts);
        this.preview_geometry.attributes.position.needsUpdate = true;
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
        var index = this.raycast_vertex_index(mouse, camera, caster);
        if (index < 0)
            return index;
        
        return this.voro.cell_from_vertex(index);
    };
    this.raycast_neighbor = function(mouse, camera, caster) {
        var index = this.raycast_vertex_index(mouse, camera, caster);
        if (index < 0)
            return index;
        
        return this.voro.cell_neighbor_from_vertex(index);
    };

    this.symmetries = {
        Mirror: function() {
            this.iters = 1;
            this.op = function(pt) {
                return [-pt[0], pt[1], pt[2]];
            };
        },
        Rotational: function(rotations) {
            this.iters = rotations-1;
            this.theta = 2.0*Math.PI / rotations;
            this.cos = Math.cos(this.theta);
            this.sin = Math.sin(this.theta);
            this.op = function(pt) {
                var pnew = [pt[0]*this.cos-pt[1]*this.sin, pt[0]*this.sin+pt[1]*this.cos, pt[2]];
                return pnew;
            };
        },
        Dihedral: function(rotations) {
            this.iters = 2*rotations-1;
            this.theta = 2.0*Math.PI / rotations;
            this.cos = Math.cos(this.theta);
            this.sin = Math.sin(this.theta);
            this.op = function(pt, i) {
                // always mirror
                pt = [pt[0]*this.cos+pt[1]*this.sin, pt[0]*this.sin-pt[1]*this.cos, pt[2]];
                if ((i % 2) === 1) { // alternately rotate
                    pt = [pt[0]*this.cos-pt[1]*this.sin, pt[0]*this.sin+pt[1]*this.cos, pt[2]];
                }
                return pt;
            };
        },
        Scale: function(scales) {
            this.iters = scales-1;
            this.scale = 0.9;
            var invert = function(s) {
                var inv = 1.0/s;
                var acc = 1.0;
                for (var i=0; i<scales-1; i++) {
                    acc = acc*inv;
                }
                return acc;
            };
            this.inverse = invert(this.scale);
            this.op = function(pt, i) {
                var s = this.scale;
                if ((i+1)%scales===0) {
                    s = this.inverse;
                }
                var pnew = [pt[0]*s, pt[1]*s, pt[2]*s];
                return pnew;
            };
        }
    };
    this.sym_map = {};
    this.active_sym = null;

    this.bake_symmetry = function() {
        if (this.active_sym) {
            this.track_act(new SetSymAct(null, {}));
            this.active_sym = null;
            this.sym_map = {};
        }
    };

    this.make_sym_cell = function(sym_map, sym_op, cell_ind) {
        var id = this.voro.stable_id(cell_ind);
        if (id in sym_map) {
            return;
        }
        sym_map[id] = {};
        sym_map[id].primary = id;
        sym_map[id].linked = [];
        var cell = this.voro.cell(cell_ind);
        var p = cell.pos;
        var type = cell.type;
        var type_override;
        for (var iter=0; iter<sym_op.iters; iter++) {
            p = sym_op.op(p,iter);
            var existing_cell = this.voro.cell_at_pos(p);
            if (existing_cell >= 0 && existing_cell != cell_ind) {
                var existing_id = this.voro.stable_id(existing_cell);
                if (!(existing_id in sym_map)) {
                    sym_map[id].linked.push(existing_id);
                    sym_map[existing_id] = {};
                    sym_map[existing_id].primary = id;
                    var old_type = this.voro.cell_type(existing_cell);
                    if (type > old_type) {
                        this.set_cell(existing_cell, type, true);
                    } else if (type < old_type) {
                        type_override = old_type;
                    }
                    continue;
                }
            }
            var new_cell = this.add_cell_list_noup(p, type, true);
            var new_id = this.voro.stable_id(new_cell);
            sym_map[id].linked.push(new_id);
            sym_map[new_id] = {};
            sym_map[new_id].primary = id;
        }
        if (type_override) {
            this.set_cell(cell_ind, type_override, true);
            var linked = sym_map[id].linked;
            for (var slink=0; slink<linked.length; slink++) {
                var index = this.voro.index_from_id(linked[slink]);
                this.set_cell(index, type_override, true);
            }
        }
    };

    this.enable_symmetry = function(sym_op) {
        this.voro.clear_gl();
        this.track_act(new StopGLAct());
        this.bake_symmetry();
        var orig_cells = this.voro.cell_count();
        
        // build a mapping of linked points
        var sym_map = {};
        for (var i=0; i<orig_cells; i++) {
            this.make_sym_cell(sym_map, sym_op, i);
        }

        this.track_act(new SetSymAct(sym_op, sym_map));
        this.track_act(new StartGLAct());

        // setting these two activates the symmetry
        this.sym_map = sym_map;
        this.active_sym = sym_op;

        // update view
        this.voro.gl_build(this.est_max_tris, this.est_max_preview_verts, this.est_max_cell_sites);
        this.update_geometry();
    };

    this.clear_preview = function() {
        this.voro.gl_clear_wires();
        this.preview_lines.visible = false;
    };
    this.add_preview = function(cell, sym_flag) {
        if (cell < 0) {
            return;
        }
        this.voro.gl_add_wires(cell);
        if (this.active_sym && !sym_flag) {
            var l = this.ordered_sym_list(cell);
            for (var i=0; i<l[0].length; i++) {
                this.add_preview(this.voro.index_from_id(l[0][i]), true);
            }
        }
        this.preview_lines.visible = true;
    };
    this.set_preview = function(cell) {
        this.clear_preview();
        this.add_preview(cell);
        this.update_preview();
    };

    this.get_sym_pid = function(cell) {
        return this.sym_map[this.voro.stable_id(cell)].primary;
    };
    this.ordered_sym_list = function(cell) { 
        // return list of ids of all other cells linked to cell,
        //  in order s.t. op(cell)  gives the 1st in the list, 
        //             op(op(cell)) gives the 2nd in the list
        var id = this.voro.stable_id(cell);
        var pid = this.sym_map[id].primary;
        var linked = this.sym_map[pid].linked;
        if (id === pid) {
            return [linked, 0];
        } else {
            var ind = linked.indexOf(id);
            var l = linked.slice(ind+1,linked.length);
            l.push(pid);
            l = l.concat(linked.slice(0,ind));
            return [l, ind+1];
        }
    };
    this.set_cell = function(cell, state, sym_flag) { // sym_flag is true if fn was called from w/in a symmetry op, undefined/falsey o.w.
        if (cell < 0) { return; }
        this.track_act(new SetCellAct([cell], [state]));
        this.voro.set_cell(cell, state);
        if (!sym_flag) {
            if (this.active_sym) {
                var slist = this.ordered_sym_list(cell);
                for (var i=0; i<slist[0].length; i++) {
                    this.set_cell(this.voro.index_from_id(slist[0][i]), state);
                }
            }
        }
    };
    this.toggle_cell = function(cell, sym_flag) { // sym_flag is true if fn was called from w/in a symmetry op, undefined/falsey o.w.
        if (cell < 0) { return; }
        this.track_act(new ToggleAct([cell], this.active_type));
        this.voro.toggle_cell(cell, this.active_type);
        if (!sym_flag) {
            if (this.active_sym) {
                var slist = this.ordered_sym_list(cell);
                for (var i=0; i<slist[0].length; i++) {
                    this.toggle_cell(this.voro.index_from_id(slist[0][i]), true);
                }
            }
            this.update_geometry();
        }
    };
    this.delete_cell = function(cell) {
        var cell_list = [cell];
        var i;
        if (this.active_sym) {
            var slist = this.ordered_sym_list(cell);
            var keys_to_kill = [];
            for (i=0; i<slist[0].length; i++) {
                var sid = slist[0][i];
                cell_list.push(this.voro.index_from_id(sid));
                keys_to_kill.push(sid);
            }
            keys_to_kill.push(this.voro.stable_id(cell));
            this.track_act(new UpdateSymAct([], keys_to_kill));
            for (i=0; i<keys_to_kill.length; i++) {
                delete this.sym_map[keys_to_kill[i]];
            }
        }
        var act = new DeleteAct(cell_list);
        this.track_act(act);
        act.redo();
        this.update_geometry(); 
    };
    this.cell_pos = function(cell) {
        return this.voro.cell_pos(cell);
    };
    this.cell_type = function(cell) {
        return this.voro.cell_type(cell);
    };
    this.sanity = function(name) {
        return this.voro.sanity(name||"unlabelled sanity check");
    };


    // export functions

    this.get_binary_stl_buffer = function() {
        this.verts_ptr = this.voro.gl_vertices();
        var num_tris = this.voro.gl_tri_count();
        var array = Module.HEAPF32.subarray(this.verts_ptr/4, this.verts_ptr/4 + num_tris*3*3);
        var buffer = new ArrayBuffer(80+4+num_tris*(4*4*3+2)); // buffer w/ space for whole stl
        var view = new DataView(buffer);
        view.setInt32(80, num_tris, true);
        for (var i=0; i<num_tris; i++) {
            for (var vi=0; vi<3; vi++) {
                for (var di=0; di<3; di++) {
                    view.setFloat32(80+4+i*(4*4*3+2)+4*3*(vi+1)+4*di, array[i*3*3+vi*3+di], true);
                }
            }
        }
        return buffer;
    };

    // custom binary file format
    // v1: [int32 file_type_id_number=1619149277] [int32 ver=1]
    //       {[float32 x] [float32 y] [float32 z]}*3*2 (<- the bounding box min and max points)
    //       [int32 types_count] {[int32 type] [int32 count] {[float32 x] [float32 y] [float32 z]}*count}*state_count
    //       [int32 palette size] {[float32 r] [float32 g] [float32 b]}*count}
    this.get_binary_raw_buffer = function() {
        var key, k, i, t;
        var num_cells = this.voro.cell_count();
        var type_counts = {};
        for (i=0; i<num_cells; i++) {
            t = this.voro.cell(i).type;
            type_counts[t] = type_counts[t] || 0;
            type_counts[t] += 1;
        }
        var sorted_types = Object.keys(type_counts);
        sorted_types.sort();
        var num_types = sorted_types.length;
        var type_starts = {};

        var header_size = 4+4+2*3*4+4; // special number and version and bounding box min&max and # types
        var typeblock_header_size = 4+4; // type id and num cells w/ that type
        var cell_size = 3*4; // 3 float32s (just posn)

        var start = header_size;
        for (k=0; k<num_types; k++) {
            key = sorted_types[k];
            type_starts[key] = start;
            start += typeblock_header_size+type_counts[key]*cell_size;
        }
        var palette_start = start;
        var total_size = start + 4 + this.palette_length()*3*4;
        
        var buffer = new ArrayBuffer(total_size);
        var view = new DataView(buffer);
        view.setInt32(0, 1619149277, true);
        view.setInt32(4, 1, true); // version
        for (i=0; i<3; i++) {
            view.setFloat32(   8+i*4, this.min_point[i], true);
            view.setFloat32(8+12+i*4, this.max_point[i], true);
        }
        view.setInt32(8+24, num_types, true); // types_count

        var type_place_in_arr = {};

        // put the header for each type block
        for (k=0; k<num_types; k++) {
            key = sorted_types[k];
            view.setInt32(type_starts[key]+0, key, true);
            view.setInt32(type_starts[key]+4, type_counts[key], true);
            type_place_in_arr[key] = type_starts[key]+typeblock_header_size;
        }

        for (i=0; i<num_cells; i++) {
            var c = this.voro.cell(i);
            t = c.type;
            var place_in_arr = type_place_in_arr[t];
            view.setFloat32(place_in_arr+0, c.pos[0], true);
            view.setFloat32(place_in_arr+4, c.pos[1], true);
            view.setFloat32(place_in_arr+8, c.pos[2], true);
            type_place_in_arr[t] = place_in_arr + cell_size;
        }

        view.setInt32(palette_start, this.palette_length(), true);
        for (i=0; i<this.palette.length; i++) {
            var arr_s = palette_start + 4 + i*3*4;
            view.setFloat32(arr_s+0, this.palette[i][0], true);
            view.setFloat32(arr_s+4, this.palette[i][1], true);
            view.setFloat32(arr_s+8, this.palette[i][2], true);
        }

        return buffer;
    };

    this.incr_active_type = function() {
        if (!this.active_type) {
            this.active_type = 1;
        }
        var new_type = 1;
        if (this.palette_length() > 0) {
            new_type = ((this.active_type) % this.palette_length()) + 1;
        }
        var act = new SetActiveTypeAct(this.active_type, new_type);
        this.track_act(act);
        act.redo();
    };

    this.create_from_raw_buffer = function(buffer) {
        var view = new DataView(buffer);
        var idflag = view.getInt32(0, true);
        if (idflag != 1619149277) {
            console.log("WARNING: tried to load from raw buffer but it didn't have the magic number in front -- so is not a voro buffer!");
            return false;
        }
        var version = view.getInt32(4, true);
        if (version != 1) {
            console.log("WARNING: tried to load cells from raw buffer but found unknown version id: " + version);
            return false;
        }

        var header_size = 8;

        var offset = header_size;
        var bbmin = 
            [view.getFloat32(offset+0, true),
             view.getFloat32(offset+4, true),
             view.getFloat32(offset+8, true)];
        offset += 12;
        var bbmax =
            [view.getFloat32(offset+0, true),
             view.getFloat32(offset+4, true),
             view.getFloat32(offset+8, true)];
        offset += 12;
        this.create_voro(bbmin, bbmax);


        var cur_pos = offset;
        var num_types = view.getInt32(cur_pos, true);
        cur_pos += 4;
        for (var i=0; i<num_types; i++) {
            var type = view.getInt32(cur_pos, true); cur_pos += 4;
            var num_pts = view.getInt32(cur_pos, true); cur_pos += 4;
            for (var pi=0; pi<num_pts; pi++) {
                var x = view.getFloat32(cur_pos, true); cur_pos += 4;
                var y = view.getFloat32(cur_pos, true); cur_pos += 4;
                var z = view.getFloat32(cur_pos, true); cur_pos += 4;
                this.voro.add_cell([x,y,z], type);
            }
        }

        if (cur_pos < view.byteLength) {
            var p_len = view.getInt32(cur_pos, true); cur_pos += 4;
            this.palette = [];
            for (i=0; i<p_len; i++) {
                var r = view.getFloat32(cur_pos, true); cur_pos += 4;
                var g = view.getFloat32(cur_pos, true); cur_pos += 4;
                var b = view.getFloat32(cur_pos, true); cur_pos += 4;
                this.palette.push([r,g,b]);
            }
            this.set_palette(this.palette);
        }

        return true;
    };





    // Chaos functions are part of sanity checking / debugging code
    var chaos_limit = 1000;
    this.do_chaos = function() {
        var cell = 0;
        var sanity = true;

        if (chaos_limit===1000) this.voro.set_sanity_level(0);

        var rpos = function() {
            return [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10];
        };
        var rcell = function() {
            return Math.random()*that.voro.cell_count();
        };
        
        if (chaos_limit === null || chaos_limit-- > 0) {
            var choice = Math.random()*4;
            if (Math.floor(choice) === 0) {
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
            }
            else if (Math.floor(choice) === 1) {
                this.voro.delete_cell(0);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
            } else if (Math.floor(choice) === 2) {
                this.voro.add_cell(rpos(), true);
                this.voro.add_cell(rpos(), true);
                this.voro.add_cell(rpos(), true);
                this.voro.add_cell(rpos(), true);
                this.voro.add_cell([1,1,1], true);
                this.voro.add_cell([1+Math.random()*.001,1+Math.random()*.001,1+Math.random()*.001], true);
                this.voro.add_cell([0,Math.random()*.1-.05,0], true);
                this.voro.add_cell([0,Math.random()*1000-500,0], true);
            } else {
                this.voro.move_cell(rcell(),rpos());
                this.voro.move_cell(rcell(),[0,Math.random()*1000-500,0]);
                this.voro.move_cell(0,[0,Math.random()*40-20,0]);
                this.voro.move_cells([rcell(),rcell(),rcell()], [rpos(),rpos(),rpos()]);
                var pos = rpos();
                cell = this.voro.add_cell(pos, true);
                this.voro.move_cell(cell,pos);
                pos[0] += 0.01;
                this.voro.move_cell(cell,pos);
            }
            var preview_cell = Math.floor(Math.random()*this.voro.cell_count());
            this.set_preview(preview_cell);
            this.update_geometry();
            
            if (chaos_limit%30===0) {
                this.voro.set_sanity_level(1);
                sanity = this.sanity("after chaos_limit="+chaos_limit);
                this.voro.set_sanity_level(0);
            }
        }

        // if we're done, check sanity
        if (chaos_limit !== null && chaos_limit === 0) {
            console.log("chaos over -- checking sanity at end ...");
            this.voro.set_sanity_level(1);
            sanity = this.sanity("after chaos");
            console.log("sanity = " + sanity);
        }
    };
};

Voro3.prototype.constructor = Voro3;