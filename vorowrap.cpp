// this will be a wrapper around voro++ functionality, helping exposing it to js (and threejs specifically)

#include <iostream>
#include <algorithm>
#include <unordered_set>
#include <unordered_map>
#include <stdlib.h>
#include <math.h>

#ifdef EMSCRIPTEN
#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>
#endif

#include "voro++/voro++.hh"
#include "glm/vec3.hpp"
#include "glm/gtx/norm.hpp"

using namespace std;
using namespace emscripten;

// define this to disable all (expensive, debugging-only) sanity checking; INSANITY is recommended for a final build
#define INSANITY
// define this to 1 to add the shared faces of neighboring cells that are both toggled 'on'; if the cells are solid, 0 is preferred
#define ADD_ALL_FACES_ALL_THE_TIME 0
// the minimum squared distance between two cells.  If you try to move or add a cell closer to another cell than this threshold, the move
// or add may be prevented.  (TODO: instead of preventing the move or add, keep the cell out of the diagram but track the cell explicitly as 'shadowed')
//      note on shadowing: this is needed b/c:
//          1. cells that are directly on top of one another would break things
//          2. cells that are very very close to one another create inconsistencies due to floating point error.
//              these inconsistencies make maintaining the diagram over time much more difficult
//                  - cell shapes begin to depend on insertion order
//                  - it seems that cells can be created in ways that would break the sanity check? e.g., broken back-links
#define SHADOW_SEP_DIST .003
#define SHADOW_THRESHOLD (SHADOW_SEP_DIST*SHADOW_SEP_DIST)

inline void jitter(glm::vec3 &pt, double amt) {
    pt.x+=amt*(rand()%10000)/10000.0;
    pt.y+=amt*(rand()%10000)/10000.0;
    pt.z+=amt*(rand()%10000)/10000.0;
}

#ifdef INSANITY
#define SANITY(WHEN) {}
#else
#define SANITY(WHEN) {sanity(WHEN);}
#endif

// main is called once emscripten has asynchronously loaded all it needs to call the other C functions
// so we wait for its call to run the js init
int main() {
    emscripten_run_script("ready_for_emscripten_calls = true;");
}

// indices to connect cell to voro++ container
struct CellConLink {
    int ijk;    // block index in voro++ container
    int q;      // index of the cell within the block (following var naming from c_loops.hh)
    
    CellConLink() : ijk(-1), q(-1) {} // invalid / fail-fast defaults
    CellConLink(const voro::c_loop_base &loop) : ijk(loop.ijk), q(loop.q) {}
    CellConLink(int ijk, int q) : ijk(ijk), q(q) {}

    bool valid() {
        return ijk >= 0 && q >= 0;
    }
    void set(const voro::c_loop_base &loop) {
        ijk = loop.ijk;
        q = loop.q;
    }
};

// defining information about cell
struct Cell {
    glm::vec3 pos;
    int type; // 0 is empty, non-zero is non-empty; can use different numbers as tags or material types

    Cell() {}
    Cell(glm::vec3 pos, int type) : pos(pos), type(type) {}
};

struct CellCache { // computations from a voro++ computed cell
    vector<int> faces; // faces as voro++ likes to store them -- packed as [#vs in f0, f0 v0, f0 v1, ..., #vs in f1, ...]
    vector<double> vertices; // vertex coordinates, indexed by faces array
    vector<int> neighbors; // cells neighboring each face
    
    void clear() { faces.clear(); vertices.clear(); neighbors.clear(); }
    void create(const glm::vec3 &pos, voro::voronoicell_neighbor &c) {
        c.neighbors(neighbors);
        // fills facev w/ faces as (#verts in face 1, face vert ind 1, ind 2, ..., #vs in f 2, f v ind 1, etc)
        c.face_vertices(faces);
        // makes all the vertices for the faces to reference
        c.vertices(pos.x, pos.y, pos.z, vertices);
    }
    double doublearea(int i, int j, int k) {
        double a[3] = {
            vertices[j*3+0]-vertices[i*3+0],
            vertices[j*3+1]-vertices[i*3+1],
            vertices[j*3+2]-vertices[i*3+2]
        };
        double b[3] = {
            vertices[k*3+0]-vertices[i*3+0],
            vertices[k*3+1]-vertices[i*3+1],
            vertices[k*3+2]-vertices[i*3+2]
        };
        double o[3] = {
            a[1]*b[2]-a[2]*b[1],
            a[2]*b[0]-a[0]*b[2],
            a[0]*b[1]-a[1]*b[0]
        };
        return sqrt(o[0]*o[0]+o[1]*o[1]+o[2]*o[2]);
    }
    double face_size(int face) {
        size_t i=0, fi=0;
        for (; fi<face && i<faces.size(); fi++,i+=faces[i]+1) {}
        double area = 0;
        if (i<faces.size()) {
            int vicount = faces[i];
            int vs[3] = {faces[i+1], 0, faces[i+2]};
            for (int j = i+3; j < i+vicount+1; j++) { // facev
                vs[1] = faces[j];
                
                area += doublearea(vs[0],vs[1],vs[2]);
                
                vs[2] = vs[1];
            }
        }
        return area*.5;
    }
};

struct CellToTris {
    vector<int> tri_inds; // indices into the GLBufferManager's vertices array, indicating which triangles are from this cell
                            // i.e. if tri_inds[0]==47, then vertices[47*3] ... vertices[47*3+2] (incl.) are from this cell
    vector<short> tri_faces;
    CellCache cache;
};

struct Voro;

struct GLBufferManager {
    vector<float> vertices, wire_vertices, cell_sites, cell_site_sizes;
    int tri_count, max_tris, max_sites;
    int wire_vert_count, wire_max_verts;
    vector<int> cell_inds; // map from tri indices to cell indices
    vector<short> cell_internal_inds; // map from tri indices to internal tri backref
    voro::voronoicell_neighbor vorocell; // reused temp var, holds computed cell info
    
    vector<CellToTris*> info;
    
    GLBufferManager() : wire_vert_count(0), wire_max_verts(0), tri_count(0), max_tris(0), cell_inds(0) {}
    
    bool sanity(string when, bool doassert=true) {
        bool valid = true;
        for (int ci=0; ci<tri_count; ci++) {
            if (cell_inds[ci] < 0 || cell_inds[ci] >= info.size()) {
                valid = false;
                cout << "invalid cell! " << cell_inds[ci] << " vs " << info.size() << endl;
            }
        }
        for (int i=0; i<info.size(); i++) {
            if (info[i]) {
                for (int ti : info[i]->tri_inds) {
                    if (cell_inds[ti] != i) {
                        valid = false;
                        cout << "invalid backlink " << cell_inds[ti] << " vs " << i << endl;
                    }
                }
                for (size_t nii=0; nii<info[i]->cache.neighbors.size(); nii++) {//(int ni : info[i]->cache.neighbors) {
                    int ni = info[i]->cache.neighbors[nii];
                    if (ni >= int(info.size())) {
                        valid = false;
                        cout << "neighbor index is out of bounds: " << i << ": " << ni << " vs " << info.size() << endl;
                    }
                    if (ni >= 0 && ni < int(info.size()) && info[ni]) {
                        bool backlink = false;
                        for (int nni : info[ni]->cache.neighbors) {
                            if (nni == i) {
                                backlink = true;
                            }
                        }
                        if (!backlink) {
                            cout << "neighbor " << i << " -> " << ni << " lacks backlink" << endl;
                            double face_area = info[i]->cache.face_size(nii);
                            if (face_area < 4.84704e-14) {
                                cout << "backlink error on face so small (" << face_area  << ") so maybe we don't care?" << endl;
                            } else {
                                valid = false;
                            }
                        }
                    }
                }
            }
        }
        
        if (!valid) {
            cout << "invalid " << when << endl;
        }
        
        assert(!doassert || valid);
        
        return valid;
    }
    
    void resize_buffers() {
        vertices.resize(max_tris*9);
        cell_inds.resize(max_tris);
        cell_internal_inds.resize(max_tris);
    }
    void resize_wire_buffers() {
        wire_vertices.resize(wire_max_verts*3);
    }
    void resize_sites_buffers() {
        cell_sites.resize(max_sites*3);
        cell_site_sizes.resize(max_sites);
    }

    void init(int numCells, int triCapacity, int wiresCapacity, int sitesCapacity) {
        clear();
        
        max_tris = triCapacity;
        wire_max_verts = wiresCapacity;
        max_sites = numCells*2;
        if (max_sites < sitesCapacity) max_sites = sitesCapacity;
        
        resize_buffers();
        resize_wire_buffers();
        resize_sites_buffers();
        tri_count = 0;
        wire_vert_count = 0;
        
        info.resize(numCells, 0);
    }
    
    void add_cell(Voro &src);
    
    int vert2cell(int vi) {
        if (vi < 0 || vi >= tri_count*3)
            return -1;
        return cell_inds[vi/3];
    }
    int vert2cell_neighbor(int vi) {
        if (vi < 0 || vi >= tri_count*3) return -1;
        int tri = vi / 3;
        int cell = cell_inds[tri];
        CellToTris *in = info[cell];
        if (!in) return -1;
        int fi = in->tri_faces[cell_internal_inds[tri]];
        return in->cache.neighbors[fi];
    }
    
    inline void clear_cell_tris(CellToTris &c2t) {
        for (int tri : c2t.tri_inds) {
            swapnpop_tri(tri);
        }
        c2t.tri_inds.clear();
        c2t.tri_faces.clear();
    }
    inline void clear_cell_cache(CellToTris &c2t) {
        c2t.cache.clear();
    }
    inline void clear_cell_all(CellToTris &c2t) {
        clear_cell_tris(c2t);
        clear_cell_cache(c2t);
    }
    
    inline CellToTris& get_clean_cell(int cell) {
        if (!info[cell]) {
            info[cell] = new CellToTris();
        } else {
            clear_cell_all(*info[cell]);
        }
        return *info[cell];
    }
    
    void recompute_neighbors(Voro &src, int cell);
    
    CellCache *get_cache(int cell) {
        if (cell < 0 || cell >= info.size() || !info[cell]) {
            return 0;
        }
        return &info[cell]->cache;
    }
    
    
    inline bool add_tri(const vector<double> &input_v, int* vs, int cell, CellToTris &c2t, int f) {
        if (tri_count+1 >= max_tris) {
            max_tris *= 2;
            resize_buffers();
        }
        
        float *v = &vertices[0] + tri_count*9;
        for (int vii=0; vii<3; vii++) {
            int ibase = vs[vii]*3;
            for (int ii=0; ii<3; ii++) {
                *v = input_v[ibase+ii];
                v++;
            }
        }
        cell_inds[tri_count] = cell;
        cell_internal_inds[tri_count] = (short)c2t.tri_inds.size();
        c2t.tri_inds.push_back(tri_count);
        c2t.tri_faces.push_back(f);

        
        tri_count++;
        
        return true;
    }
    
    void set_cell(Voro &src, int cell, int oldtype);
    
    void compute_cell(Voro &src, int cell); // compute caches for all cells and add tris for non-zero cells

    void compute_all(Voro &src, int tricap, int wirecap, int sitescap);
    
    void add_cell_tris(Voro &src, int cell, CellToTris &c2t);
   
    void swapnpop_tri(int tri) {
        if (tri+1 != tri_count) {
            int ts = tri_count-1;
            assert(ts > 0);
            for (int ii=0; ii<9; ii++) {
                vertices[tri*9+ii] = vertices[ts*9+ii];
            }
            cell_inds[tri] = cell_inds[ts];
            cell_internal_inds[tri] = cell_internal_inds[ts];
            info[cell_inds[tri]]->tri_inds[cell_internal_inds[tri]] = tri;
        }
        tri_count--;
    }
    
    void swapnpop_cell(Voro &src, int cell, int lasti);
    void move_cell(Voro &src, int cell);
    void move_cells(Voro &src, const unordered_set<int> &cells);
    
    void update_site(Voro &src, int cell);
    inline void update_site_pos(const glm::vec3 &pos, int cell) {
        assert(cell >= 0 && cell < cell_sites.size());
        cell_sites[cell*3]   = pos.x;
        cell_sites[cell*3+1] = pos.y;
        cell_sites[cell*3+2] = pos.z;

    }
    inline void update_site_size(float size, int cell) {
        cell_site_sizes[cell] = size;
    }
    
    void add_wires(Voro &src, int cell);
    inline void add_wire_vert(const vector<double> &vertices, int vi) {
        assert(vi*3+2 < vertices.size());
        if (wire_vert_count >= wire_max_verts) {
            wire_max_verts *= 2;
            resize_wire_buffers();
        }
        float *buf = &wire_vertices[0] + (wire_vert_count*3);

        *buf = vertices[vi*3]; buf++;
        *buf = vertices[vi*3+1]; buf++;
        *buf = vertices[vi*3+2]; buf++;
        wire_vert_count++;
    }
    void clear_wires() {
        wire_vert_count = 0;
    }
    
    void clear() {
        vertices.clear();
        //normals.clear();
        cell_inds.clear();
        wire_vertices.clear();
        cell_sites.clear();
        cell_site_sizes.clear();
        
        tri_count = max_tris = max_sites = 0;
        
        for (auto *c : info) {
            delete c;
        }
        info.clear();
    }
};

enum { SANITY_MINIMAL, SANITY_FULL, SANITY_EXCESSIVE };

struct Voro {
    Voro()
        : b_min(glm::vec3(-10)), b_max(glm::vec3(10)), con(0), sanity_level(SANITY_FULL), tracked_ids(0) {}
    Voro(glm::vec3 bound_min, glm::vec3 bound_max)
        : b_min(bound_min), b_max(bound_max), con(0), sanity_level(SANITY_FULL), tracked_ids(0) {}
    ~Voro() {
        clear_computed();
    }
    
    template<typename T> bool compare_vecs(vector<T> a, vector<T> b, string name, int tag) {
        sort(a.begin(), a.end());
        sort(b.begin(), b.end());
        if (!equal(a.begin(), a.end(), b.begin())) {
            cout << name << " mismatched on " << tag << endl << "F: ";
            for (const auto &i: a)
                cout << i << ' ';
            cout << endl << "T: ";
            for (const auto &i: b)
                cout << i << ' ';
            cout << endl;
            return false;
        } else {
            return true;
        }
    }
    
    bool sanity(string when) {
        bool valid = true;
        
        if (sanity_level > 0) {
            valid = gl_computed.sanity(when, false);
        }
        for (int cell=0; cell<links.size(); cell++) {
            const auto &link = links[cell];
            if (link.ijk >= 0 && link.q < 0) {
                cout << "partially valid link " << cell << ": " << link.ijk << " " << link.q << endl;
                valid = false;
            }
        }
        if (sanity_level > 0) {
            if (gl_computed.info.size() > 0) {
                if (gl_computed.info.size() != cells.size()) {
                    cout << "computed info cells mismatch voro cells: " << gl_computed.info.size() << " vs " << cells.size() << endl;
                    valid = false;
                }
                for (int i=0; i<cells.size(); i++) {
                    CellCache cache;
                    if (gl_computed.info[i]) {
                        auto &link = links[i];
                        if (link.valid()) {
                            if (con->compute_cell(gl_computed.vorocell, link.ijk, link.q)) {
                                cache.create(cells[i].pos, gl_computed.vorocell);
                                auto &vs = gl_computed.info[i]->cache;
                                valid = compare_vecs(vs.neighbors, cache.neighbors, "neighbors", i) && valid;
//                                bool fvalid = compare_vecs(vs.faces, cache.faces, "faces", i);
//                                valid = fvalid && valid;
//                                valid = compare_vecs(vs.vertices, cache.vertices, "vertices", i) && valid;
                            }
                        }
                    }
                }
                if (sanity_level > 1) {
                    // Use a pre_container to automatically figure out the right settings for the container we create
                    voro::pre_container pcon(b_min.x,b_max.x,b_min.y,b_max.y,b_min.z,b_max.z,false,false,false);
                    
                    {
                        // iterating through particles && try to match order in the blocks to guarantee same numerical result
                        voro::c_loop_all vl(*con);
                        if (vl.start()) do {
                            int i = vl.pid();
                            pcon.put(i,cells[i].pos.x,cells[i].pos.y,cells[i].pos.z);
                        } while(vl.inc());
                    }
                    
                    // Set up the number of blocks that the container is divided into
                    int n_x, n_y, n_z;
                    pcon.guess_optimal(n_x,n_y,n_z);
                    
                    // Set up the container class and import the particles from the pre-container
                    voro::container dcon(pcon.ax,pcon.bx,pcon.ay,pcon.by,pcon.az,pcon.bz,n_x,n_y,n_z,false,false,false,10);
                    pcon.setup(dcon);
                    
                    // build links
                    voro::c_loop_all vl(dcon);
                    voro::voronoicell_neighbor vorocell;
                    CellCache cache;
                    if(vl.start()) do {
                        int i = vl.pid();
                        if (dcon.compute_cell(vorocell, vl.ijk, vl.q)) {
                            cache.create(cells[i].pos, vorocell);
                            if (gl_computed.info[i]) {
                                auto &vs = gl_computed.info[i]->cache;
                                bool nvalid = compare_vecs(vs.neighbors, cache.neighbors, " full-recon neighbors", i);
                                bool fvalid = compare_vecs(vs.faces, cache.faces, " full-recon faces", i);
                                valid = valid && nvalid && fvalid;
                                if (!nvalid || !fvalid) {
                                    cout << "cell[" << i << "].pos = " << cells[i].pos.x << ", " << cells[i].pos.y << ", " << cells[i].pos.z << endl;
                                }
                            } else {
                                cout << "no info for valid cell?" << endl;
                                valid = false;
                            }
                        }
                        
                    } while(vl.inc());
                }
            }
        }
        
        if (!valid) {
            cout << "sanity check on Voro failed: " << when << endl;
        }
        assert(valid);
        return valid;
    }
    
    // clears the input from which the voronoi diagram would be build (the point set)
    void clear_input() {
        cells.clear();
    }
    
    // clears out all computed structures of the voronoi diagram.
    void clear_computed() {
        delete con; con = 0;
        links.clear();
        gl_computed.clear();
    }
    
    void set_only_centermost(int centermost_type, int other_type) {
        if (cells.empty()) return;
        int minc = 0;
        double minl = glm::length2(cells[0].pos);
        set_cell(0, other_type);
        for (size_t i=1; i<cells.size(); i++) {
            double pl = glm::length2(cells[i].pos);
            if (pl < minl) {
                minc = i;
                minl = pl;
            }
            set_cell(i, other_type);
        }
        set_cell(minc, centermost_type);
    }
    
    void set_all(int type) {
        for (size_t i=0; i<cells.size(); i++) {
            set_cell(i, type);
        }
    }
    
    void set_fill(double target_fill, int rand_seed) {
        if (cells.empty()) return;
        srand(rand_seed);
        
        if (target_fill <= 0 || target_fill >= 1) {
            set_all(target_fill >= 1);
            return;
        }
        
        float fill = get_fill();
        float newfill = fill;
        const float one_cell_fill = (1.0/float(cells.size()));
        int needs_more_fill = fill < target_fill;
        while (needs_more_fill == (newfill < target_fill)) {
            int ci = rand() % cells.size();
            if ((!cells[ci].type) == needs_more_fill) {
                set_cell(ci, needs_more_fill);
                newfill = newfill + (2*needs_more_fill-1)*one_cell_fill;
            }
        }
    }
    
    float get_fill() {
        int nonz = 0;
        for (size_t i=0; i<cells.size(); i++) {
            nonz += !!cells[i].type;
        }
        return float(nonz) / float(cells.size());
    }
    
    // assuming cells vector is already created, now create the container for holding the cells
    void build_container() {
        clear_computed(); // clear out any existing computation
        
        auto d = b_max-b_min;
        float ilscale = pow(double(cells.size())/(voro::optimal_particles*d.x*d.y*d.z),1.0/3.0);
        auto n = d*ilscale;
        con = new voro::container(b_min.x,b_max.x,b_min.y,b_max.y,b_min.z,b_max.z,int(n.x+1),int(n.y+1),int(n.z+1),false,false,false,10);
        
        // build links
        assert(links.size() == 0);
        links.resize(cells.size());
        for (int i=0; i<cells.size(); i++) {
            auto &link = links[i];
            auto &pt = cells[i].pos;
            while (con->already_in_container(pt.x, pt.y, pt.z, SHADOW_THRESHOLD) >= 0) {
                jitter(pt, SHADOW_SEP_DIST);
            }
            bool ret = con->put(i, pt.x, pt.y, pt.z, link.ijk, link.q);
            if (!ret) { link = CellConLink(); } // reset link if put fails
        }
    }
    
    int cell_at_pos(glm::vec3 pt) {
        return con->already_in_container(pt.x, pt.y, pt.z, SHADOW_THRESHOLD);
    }
    
    int add_cell(glm::vec3 pt, int type) {
        while (con && con->already_in_container(pt.x, pt.y, pt.z, SHADOW_THRESHOLD) >= 0) {
            jitter(pt, SHADOW_SEP_DIST);
        }
        int id = int(cells.size());
        
        cells.push_back(Cell(pt, type));
        if (con) {
            CellConLink link;
            bool ret = con->put(id, pt.x, pt.y, pt.z, link.ijk, link.q);
            if (!ret) { link = CellConLink(); } // reset to invalid default when put fails
            links.push_back(link);
            assert(cells.size() == links.size());
            
            gl_computed.add_cell(*this);
        }
        SANITY("after add_cell");
        return id;
    }
    
    void debug_print_block(int ijk, int q) {
        if (con) {
            con->print_block(ijk, q);
        } else {
            cout << "no con; cannot print any block yet!" << endl;
        }
    }
    
    bool move_cell(int cell, glm::vec3 pt) { // similar to a delete+add, but w/ no swapping and less recomputation
        if (cell < 0 || cell >= cells.size()) {
            cout << "move_cell called w/ invalid cell (index out of range): " << cell << endl;
            return false;
        }
        while (con && con->already_in_container(pt.x, pt.y, pt.z, SHADOW_THRESHOLD, cell) >= 0) {
            jitter(pt, SHADOW_SEP_DIST);
        }
        
        cells[cell].pos = pt;
        
        if (!links.empty()) {
            assert(links.size() == cells.size());
            if (con) {
                int needsupdate_q;
                int needsupdate = con->move(links[cell].ijk, links[cell].q, cell, pt.x, pt.y, pt.z, needsupdate_q);
                if (needsupdate > -1) { // we updated q of this element, so we need to update external backrefs to reflect that
                    links[needsupdate].q = needsupdate_q; // only updating q is ok, since the swapnpop won't change the ijk
                } 
            }

            gl_computed.move_cell(*this, cell);
        }
        
        
        
        SANITY("after move_cell");
        return true;
    }
    bool move_cells(val cells_to_move, val posns) { // similar to a delete+add, but w/ no swapping and less recomputation'
        int len = cells_to_move["length"].as<int>();
        unordered_set<int> moved_cells;
        for (int i=0; i<len; i++) {
            int cell = cells_to_move[i].as<int>();
            if (cell < 0 || cell >= cells.size()) {
                cout << "move_cell called w/ invalid cell (index out of range): " << cell << endl;
                continue;
            }
            
            glm::vec3 pt(posns[i][0].as<float>(), posns[i][1].as<float>(), posns[i][2].as<float>());
            while (con && con->already_in_container(pt.x, pt.y, pt.z, SHADOW_THRESHOLD, cell) >= 0) {
                jitter(pt, SHADOW_SEP_DIST);
            }
            
            cells[cell].pos = pt;
            moved_cells.insert(cell);
            if (!links.empty()) {
                assert(links.size() == cells.size());
                if (con) {
                    int needsupdate_q;
                    int needsupdate = con->move(links[cell].ijk, links[cell].q, cell, pt.x, pt.y, pt.z, needsupdate_q);
                    if (needsupdate > -1) { // we updated q of this element, so we need to update external backrefs to reflect that
                        links[needsupdate].q = needsupdate_q; // only updating q is ok, since the swapnpop won't change the ijk
                    }
                }
            }
        }
        
        gl_computed.move_cells(*this, moved_cells);
        
        SANITY("after move_cells");
        return true;
    }
    
    bool delete_cell(int cell) { // this is a swapnpop deletion
        if (cell < 0 || cell >= cells.size()) { // can't delete out of range
            cout << "trying to delete out of range " << cell << " vs " << cells.size() << endl;
            return false;
        }

        int end_ind = int(cells.size())-1;
        cells[cell] = cells[end_ind];
        update_stable_id(end_ind, cell);
        cells.pop_back();
        if (!links.empty()) {
            assert(links.size() == cells.size()+1);
            if (con) { // swapnpop inside the container
                if (links[cell].valid()) {
                    int needsupdate = con->swapnpop(links[cell].ijk, links[cell].q);
                    if (needsupdate > -1) { // we updated q of this element, so we need to update external backrefs to reflect that
                        links[needsupdate].q = links[cell].q;
                    }
                }
                if (end_ind != cell && links[end_ind].valid()) {
                    con->id[links[end_ind].ijk][links[end_ind].q] = cell; // update the id of the cell we're swapping back
                }
            }
            links[cell] = links[end_ind];
            links.pop_back();
            
            gl_computed.swapnpop_cell(*this, cell, end_ind);
        }
        SANITY("after delete_cell");
        return true;
    }
    
    void gl_build(int max_tris_guess, int max_wire_verts_guess, int max_sites_guess) {
        // populate gl_computed with current whole voronoi diagram
        gl_computed.compute_all(*this, max_tris_guess, max_wire_verts_guess, max_sites_guess);
        
    }
    uintptr_t gl_vertices() {
        return reinterpret_cast<uintptr_t>(&gl_computed.vertices[0]);
    }
    void gl_add_wires(int cell) {
        gl_computed.add_wires(*this, cell);
        SANITY("after gl_add_wires");
    }
    void gl_clear_wires() {
        gl_computed.clear_wires();
    }
    uintptr_t gl_wire_vertices() {
        return reinterpret_cast<uintptr_t>(&gl_computed.wire_vertices[0]);
    }
    int gl_wire_vert_count() {
        return gl_computed.wire_vert_count;
    }
    int gl_wire_max_verts() {
        return gl_computed.wire_max_verts;
    }
    uintptr_t gl_cell_sites() {
        return reinterpret_cast<uintptr_t>(&gl_computed.cell_sites[0]);
    }
    uintptr_t gl_cell_site_sizes() {
        return reinterpret_cast<uintptr_t>(&gl_computed.cell_site_sizes[0]);
    }
    int gl_max_sites() {
        return gl_computed.max_sites;
    }
    int gl_tri_count() {
        return gl_computed.tri_count;
    }
    int gl_max_tris() {
        return gl_computed.max_tris;
    }
    int cell_count() {
        return cells.size();
    }
    void set_sanity_level(int sanity) {
        sanity_level = sanity;
    }
    void toggle_cell(int cell) {
        if (cell < 0 || cell >= cells.size())
            return;
        
        int oldtype = cells[cell].type;
        cells[cell].type = !oldtype;
        gl_computed.set_cell(*this, cell, oldtype);
    }
    void set_cell(int cell, int type) {
        if (cell < 0 || cell >= cells.size() || type==cells[cell].type)
            return;
        
        int oldtype = cells[cell].type;
        cells[cell].type = type;
        if (cell < gl_computed.info.size()) {
            gl_computed.set_cell(*this, cell, oldtype);
        }
    }
    int cell_from_vertex(int vert_ind) {
        return gl_computed.vert2cell(vert_ind);
    }
    int cell_neighbor_from_vertex(int vert_ind) {
        return gl_computed.vert2cell_neighbor(vert_ind);
    }
    glm::vec3 cell_pos(int cell) {
        assert(cell>=0 && cell<cells.size());
        return cells[cell].pos;
    }
    int cell_type(int cell) {
        assert(cell>=0 && cell<cells.size());
        return cells[cell].type;
    }
    Cell cell(int c) {
        assert(c>=0 && c<cells.size());
        return cells[c];
    }
    
    size_t stable_id(int cell) {

        if (!cell_to_id.count(cell)) {
            auto id = tracked_ids++;
            cell_to_id[cell] = id;
            id_to_cell[id] = cell;
        }
        return cell_to_id[cell];
    }
    // use this to re-associate cells to ids, e.g. if you undo a deletion.
    // cell and id must both be unmapped when this is called.
    // id must be one that has already been used (< tracked_ids) so that it will not collide with new ids.
    void set_stable_id(int cell, size_t id) {
        // only allow setting id for cells that do not have an id yet
        assert(!id_to_cell.count(id));
        assert(!cell_to_id.count(cell));
        assert(id < tracked_ids);
        
        id_to_cell[id] = cell;
        cell_to_id[cell] = id;
    }
    int index_from_id(size_t id) {
        if (!id_to_cell.count(id)) {
            return -1;
        } else {
            return id_to_cell[id];
        }
    }


protected:
    friend class GLBufferManager;
    
    // library user populates the bounds and the cells vector
    // these define the truth of what the voronoi diagram should be.
    union { // bounding box range
        struct {glm::vec3 b_min, b_max;};
        glm::vec3 bounds[2];
    };
    vector<Cell> cells;
    
    voro::container *con;
    int sanity_level; // level of error checking.  define "INSANITY" for zero error checking
    // note: links vector MUST be kept in 1:1, ordered correspondence with the cells vector
    vector<CellConLink> links; // link cells to container
    GLBufferManager gl_computed;
    
    // this sparse mapping gives stable ids to cells as needed (via the stable_id() function)
    // use stable ids to track cells externally -- cell indices will change on deletion, but stable ids remain as long as the cell does.
    unordered_map<int, size_t> cell_to_id;
    unordered_map<size_t, int> id_to_cell;
    size_t tracked_ids;
    
    // this puts the old_index into the new_index and removes everything related to what used to be at the new_index
    void update_stable_id(int old_index, int new_index) {
        if (cell_to_id.count(new_index)) {
            auto id_to_remove = cell_to_id[new_index];
            id_to_cell.erase(id_to_remove);
        }
        if (cell_to_id.count(old_index)) {
            auto id = cell_to_id[old_index];
            cell_to_id.erase(old_index);
            if (old_index!=new_index) {
                cell_to_id[new_index] = id;
                id_to_cell[id] = new_index;
            }
        }
    }

};

void GLBufferManager::compute_cell(Voro &src, int cell) { // compute caches for all cells and add tris for non-zero cells
    assert(cell >= 0 && cell < info.size());
    auto &link = src.links[cell];
    
    if (!link.valid()) {
        if (info[cell]) { clear_cell_all(*info[cell]); }
        return;
    }
    CellToTris &c = get_clean_cell(cell);
    if (src.con->compute_cell(vorocell, link.ijk, link.q)) {
        c.cache.create(src.cells[cell].pos, vorocell);
        
        add_cell_tris(src, cell, c);
    }
    update_site(src, cell);
}

void GLBufferManager::compute_all(Voro &src, int tricap, int wirecap, int sitescap) {
    if (!src.con) {
        src.build_container();
    }
    init(src.cells.size(), tricap, wirecap, sitescap);
    
    assert(src.cells.size()==src.links.size());
    for (size_t i=0; i < src.cells.size(); i++) {
        compute_cell(src, i);
    }
}

void GLBufferManager::add_wires(Voro &src, int cell) {
    assert(cell >= 0 && cell < info.size());
    if (!info[cell]) {
        compute_cell(src, cell);
        if (!info[cell]) return; // happens if cell couldn't be computed -- e.g., if the cell is out of bounds
    }
    const vector<int> &faces = info[cell]->cache.faces;
    const vector<double> &vertices = info[cell]->cache.vertices;
    for (int i=0; i<faces.size(); i+=faces[i]+1) {
        int len = faces[i];
        for (int fi=0; fi<len; fi++) {
            add_wire_vert(vertices, faces[i+1+fi]);
            add_wire_vert(vertices, faces[i+1+((fi+1)%len)]);
        }
    }
}


void GLBufferManager::add_cell_tris(Voro &src, int cell, CellToTris &c2t) { // assuming the cache is fine, just add the tris for it
    assert(cell >= 0 && cell < info.size());
    CellCache &c = c2t.cache;
    int type = src.cells[cell].type;
    if (type == 0) return;
    
    for (int i = 0, ni = 0; i < (int)c.faces.size(); i+=c.faces[i]+1, ni++) {
        if ((src.cells[c.neighbors[ni]].type != type) || ADD_ALL_FACES_ALL_THE_TIME) {
            // make a fan of triangles to cover the face
            int vicount = (i+c.faces[i]+1)-(i+1);
            int vs[3] = {c.faces[i+1], 0, c.faces[i+2]};
            for (int j = i+3; j < i+c.faces[i]+1; j++) { // facev
                vs[1] = c.faces[j];
                
                add_tri(c.vertices, vs, cell, c2t, ni);
                
                vs[2] = vs[1];
            }
        }
    }
}

void GLBufferManager::set_cell(Voro &src, int cell, int oldtype) {
    assert(cell >= 0 && cell < info.size());
    if (oldtype == src.cells[cell].type) return;
    int type = src.cells[cell].type;
    
    if (info[cell]) {
        if (oldtype) clear_cell_tris(*info[cell]);
        if (!ADD_ALL_FACES_ALL_THE_TIME) { // re-add neighbors faces to manage internal faces
            // (we could try to optimize this to just look at shared faces but this seems 'fast enough' for me now)
            for (int ni : info[cell]->cache.neighbors) {
                if (ni >= 0 && info[ni]) {
                    update_site(src, ni);
                    if (src.cells[ni].type) {
                        clear_cell_tris(*info[ni]);
                        add_cell_tris(src, ni, *info[ni]);
                    }
                }
            }
        }
    }
    
    if (src.cells[cell].type == 0) {
        return;
    }
    
    if (!info[cell]) {
        compute_cell(src, cell);
    } else {
        add_cell_tris(src, cell, *info[cell]);
        update_site(src, cell);
    }
}

void GLBufferManager::recompute_neighbors(Voro &src, int cell) {
    assert(cell >= 0 && cell < info.size());
    if (info[cell]) {
        for (int ni : info[cell]->cache.neighbors) {
            if (ni >= 0) {
                compute_cell(src, ni);
            }
        }
    }
}

void GLBufferManager::swapnpop_cell(Voro &src, int cell, int lasti) {
    vector<int> to_recompute;
    if (info[cell]) {
        to_recompute = info[cell]->cache.neighbors;
        clear_cell_all(*info[cell]); // clears everything pointing to cell
        delete info[cell]; info[cell] = 0;
    }
    
    info[cell] = info[lasti]; // overwrite cell
    if (info[cell]) { // if the swap cell exists, fix backpointers to it
        for (int ni : info[cell]->cache.neighbors) { // redirect neighbor backptrs
            if (ni >= 0) {
                for (int nii=0; info[ni] && nii < info[ni]->cache.neighbors.size(); nii++) {
                    if (info[ni]->cache.neighbors[nii] == lasti) {
                        info[ni]->cache.neighbors[nii] = cell;
                    }
                }
            }
        }
        for (int ti : info[cell]->tri_inds) { // redirect tri backptrs
            cell_inds[ti] = cell;
        }
    }
    for (int ni : to_recompute) { // recompute former cell neighbors
        if (ni >= 0) {
            ni = ni<lasti? ni : cell;
            compute_cell(src, ni);
        }
    }
    
    update_site(src, cell);
    info.pop_back();
}

void GLBufferManager::move_cell(Voro &src, int cell) {
    if (info[cell]) {
        for (int ni : info[cell]->cache.neighbors) { if (ni >= 0) { compute_cell(src, ni); } }
    }
    compute_cell(src, cell);
    update_site(src, cell);
    if (info[cell]) {
        // todo: possible optimization: don't recompute a neighbor here if it was already computed above.
        for (int ni : info[cell]->cache.neighbors) { if (ni >= 0) { compute_cell(src, ni); } }
    }
}

void GLBufferManager::update_site(Voro &src, int cell) {
    update_site_pos(src.cells[cell].pos, cell);
    float size = 0;
    if (info[cell]) {
        for (auto ni : info[cell]->cache.neighbors) {
            if (ni >= 0) {
                size += float(src.cells[ni].type > 0);
            }
        }
    }
    update_site_size(size, cell);
}

void GLBufferManager::move_cells(Voro &src, const unordered_set<int> &cells) {
    unordered_set<int> computed;
    for (int cell : cells) {
        if (info[cell]) {
            for (int ni : info[cell]->cache.neighbors) { if (ni >= 0 && !cells.count(ni) && !computed.count(ni)) { compute_cell(src, ni); computed.insert(ni); } }
        }
    }
    for (int cell : cells) {
        compute_cell(src, cell);
        update_site(src, cell);
        computed.insert(cell);
    }
    for (int cell : cells) {
        if (info[cell]) {
            for (int ni : info[cell]->cache.neighbors) { if (ni >= 0 && !cells.count(ni) && !computed.count(ni)) { compute_cell(src, ni); computed.insert(ni); } }
        }
    }
}

void GLBufferManager::add_cell(Voro &src) {
    int id = (int)info.size();
    info.push_back(0);
    if (info.size() > max_sites) {
        max_sites *= 2;
        resize_sites_buffers();
    }
    
    compute_cell(src, id);
    recompute_neighbors(src, id);
    update_site(src, id);
}


EMSCRIPTEN_BINDINGS(voro) {
    value_array<glm::vec3>("vec3")
        .element(&glm::vec3::x)
        .element(&glm::vec3::y)
        .element(&glm::vec3::z)
        ;
    value_object<Cell>("Cell")
        .field("pos", &Cell::pos)
        .field("type", &Cell::type)
        ;
    class_<Voro>("Voro")
    .constructor<glm::vec3, glm::vec3>()
    .function("cell_pos", &Voro::cell_pos)
    .function("cell_type", &Voro::cell_type)
    .function("cell", &Voro::cell)
    .function("cell_at_pos", &Voro::cell_at_pos)
    .function("add_cell", &Voro::add_cell)
    .function("build_container", &Voro::build_container)
    .function("gl_build", &Voro::gl_build)
    .function("gl_vertices", &Voro::gl_vertices)
    .function("gl_tri_count", &Voro::gl_tri_count)
    .function("gl_max_tris", &Voro::gl_max_tris)
    .function("gl_cell_sites", &Voro::gl_cell_sites)
    .function("gl_cell_site_sizes", &Voro::gl_cell_site_sizes)
    .function("gl_max_sites", &Voro::gl_max_sites)
    .function("cell_count", &Voro::cell_count)
    .function("toggle_cell", &Voro::toggle_cell)
    .function("cell_neighbor_from_vertex", &Voro::cell_neighbor_from_vertex)
    .function("cell_from_vertex", &Voro::cell_from_vertex)
    .function("delete_cell", &Voro::delete_cell)
    .function("move_cell", &Voro::move_cell)
    .function("move_cells", &Voro::move_cells)
    .function("set_cell", &Voro::set_cell)
    .function("set_all", &Voro::set_all)
    .function("sanity", &Voro::sanity)
    .function("set_sanity_level", &Voro::set_sanity_level)
    .function("set_fill", &Voro::set_fill)
    .function("set_only_centermost", &Voro::set_only_centermost)
    .function("gl_add_wires", &Voro::gl_add_wires)
    .function("gl_clear_wires", &Voro::gl_clear_wires)
    .function("gl_wire_vert_count", &Voro::gl_wire_vert_count)
    .function("gl_wire_vertices", &Voro::gl_wire_vertices)
    .function("gl_wire_max_verts", &Voro::gl_wire_max_verts)
    .function("debug_print_block", &Voro::debug_print_block)
    .function("stable_id", &Voro::stable_id)
    .function("set_stable_id", &Voro::set_stable_id)
    .function("index_from_id", &Voro::index_from_id)
//    .property("min", &Voro::b_min)
//    .property("max", &Voro::b_max)
    ;
}
