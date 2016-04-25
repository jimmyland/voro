// this will be a wrapper around voro++ functionality, helping exposing it to js (and threejs specifically)

#include <iostream>

#ifdef EMSCRIPTEN
#include <emscripten.h>
#include <emscripten/bind.h>
#endif

#include "voro++/voro++.hh"
#include "glm/vec3.hpp"

using namespace std;
using namespace emscripten;

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
        return ijk >= 0;
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
};

struct CellToTris {
    vector<int> tri_inds; // indices into the GLBufferManager's vertices array, indicating which triangles are from this cell
                            // i.e. if tri_inds[0]==47, then vertices[47*3] ... vertices[47*3+2] (incl.) are from this cell
    vector<short> tri_faces;
    CellCache cache;
};

struct Voro;

struct GLBufferManager {
    float *vertices;
    int tri_count, max_tris;
    int *cell_inds; // map from tri indices to cell indices
    short *cell_internal_inds; // map from tri indices to internal tri backref
    voro::voronoicell_neighbor vorocell; // reused temp var, holds computed cell info
    
    vector<CellToTris*> info;
    
    GLBufferManager() : vertices(0), /*normals(0),*/ tri_count(0), max_tris(0), cell_inds(0) {}

    void init(int numCells, int triCapacity) {
        clear();
        
        vertices = new float[triCapacity*9];
//        normals = new float[triCapacity*9];
        cell_inds = new int[triCapacity];
        cell_internal_inds = new short[triCapacity];
        max_tris = triCapacity;
        tri_count = 0;
        
        info.resize(numCells, 0);
    }
    
    void add_cell() {
        info.push_back(0);
    }
    
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
    
    
    inline bool add_tri(const vector<double> &input_v, int* vs, int cell, CellToTris &c2t, int f) {
        if (tri_count+1 >= max_tris) {
            return false;
        }
        
        float *v = vertices + tri_count*9;
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

    void compute_all(Voro &src, int tricap);
    
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
    void swapnpop_cell(int cell) {
        assert(info[cell]);
        assert(false); // not implemented yet
        
        // todo delete all tris via swapnpop
        //  info[cell]->tri_inds
        
        // todo delete via swapnpop
    }
    
    void clear() {
        delete [] vertices;
//        delete [] normals;
        delete [] cell_inds;
        vertices = 0;
//        normals = 0;
        cell_inds = 0;
        tri_count = max_tris = 0;
        
        for (auto *c : info) {
            delete c;
        }
        info.clear();
    }
};

struct Voro {
    Voro() : b_min(glm::vec3(-10)), b_max(glm::vec3(10)), con(0) {}
    Voro(glm::vec3 bound_min, glm::vec3 bound_max) : b_min(bound_min), b_max(bound_max), con(0) {}
    ~Voro() {
        clear_computed();
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
    
    // assuming cells vector is already created, now create the container for holding the cells
    void build_container() {
        clear_computed(); // clear out any existing computation
        
        // Use a pre_container to automatically figure out the right settings for the container we create
        voro::pre_container pcon(b_min.x,b_max.x,b_min.y,b_max.y,b_min.z,b_max.z,false,false,false);
        for (int i=0; i<cells.size(); i++) {
            pcon.put(i,cells[i].pos.x,cells[i].pos.y,cells[i].pos.z);
        }
        
        // Set up the number of blocks that the container is divided into
        int n_x, n_y, n_z;
        pcon.guess_optimal(n_x,n_y,n_z);
        
        // Set up the container class and import the particles from the pre-container
        con = new voro::container(pcon.ax,pcon.bx,pcon.ay,pcon.by,pcon.az,pcon.bz,n_x,n_y,n_z,false,false,false,10);
        pcon.setup(*con);
        
        // build links
        assert(links.size() == 0);
        links.resize(cells.size());
        voro::c_loop_all vl(*con);
        if(vl.start()) do {
            links[vl.pid()].set(vl);
        } while(vl.inc());
    }
    
    int add_cell(glm::vec3 pt, int type) {
        int id = int(cells.size());
        cells.push_back(Cell(pt, type));
        if (con) {
            CellConLink link;
            con->put(id, pt.x, pt.y, pt.z, link.ijk, link.q);
            links.push_back(link);
            assert(cells.size() == links.size());
            
            gl_computed.add_cell();
            gl_computed.compute_cell(*this, id);
            gl_computed.recompute_neighbors(*this, id);
        }
        return id;
    }
    
    void gl_build(int max_tris_guess) {
        // populate gl_computed with current whole voronoi diagram
        gl_computed.compute_all(*this, max_tris_guess);
        
    }
    uintptr_t gl_vertices() {
        return reinterpret_cast<uintptr_t>(gl_computed.vertices);
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
    void toggle_cell(int cell) {
        if (cell < 0 || cell >= cells.size())
            return;
        
        int oldtype = cells[cell].type;
        cells[cell].type = !oldtype;
        gl_computed.set_cell(*this, cell, oldtype);
    }
    int cell_from_vertex(int vert_ind) {
        return gl_computed.vert2cell(vert_ind);
    }
    int cell_neighbor_from_vertex(int vert_ind) {
        return gl_computed.vert2cell_neighbor(vert_ind);
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
    // note: the below three vectors MUST be kept in 1:1, ordered correspondence with the cells vector
    vector<CellConLink> links; // link cells to container
    GLBufferManager gl_computed;

};

void GLBufferManager::compute_cell(Voro &src, int cell) { // compute caches for all cells and add tris for non-zero cells
    CellToTris &c = get_clean_cell(cell);
    
    auto &link = src.links[cell];
    if (src.con->compute_cell(vorocell, link.ijk, link.q)) {
        c.cache.create(src.cells[cell].pos, vorocell);
        
        add_cell_tris(src, cell, c);
    }
}

void GLBufferManager::compute_all(Voro &src, int tricap) {
    if (!src.con) {
        src.build_container();
    }
    init(src.cells.size(), tricap);
    
    assert(src.cells.size()==src.links.size());
    for (size_t i=0; i < src.cells.size(); i++) {
        compute_cell(src, i);
    }
}

#define ADD_ALL_FACES_ALL_THE_TIME 1

void GLBufferManager::add_cell_tris(Voro &src, int cell, CellToTris &c2t) { // assuming the cache is fine, just add the tris for it
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
    if (oldtype == src.cells[cell].type) return;
    int type = src.cells[cell].type;
    
    if (info[cell] && oldtype) {
        clear_cell_tris(*info[cell]);
        if (!type) { // recompute neighbors that may be revealed
            for (int ni : info[cell]->cache.neighbors) {
                if (ni >= 0 && info[ni] && src.cells[ni].type) {
                    clear_cell_tris(*info[ni]);
                    add_cell_tris(src, ni, *info[ni]);
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
    }
}

void GLBufferManager::recompute_neighbors(Voro &src, int cell) {
    if (info[cell]) {
        for (int ni : info[cell]->cache.neighbors) {
            if (ni >= 0) {
                compute_cell(src, ni);
            }
        }
    }
}


EMSCRIPTEN_BINDINGS(voro) {
    value_array<glm::vec3>("vec3")
    .element(&glm::vec3::x)
    .element(&glm::vec3::y)
    .element(&glm::vec3::z)
    ;
    class_<Voro>("Voro")
    .constructor<glm::vec3, glm::vec3>()
    .function("add_cell", &Voro::add_cell)
    .function("build_container", &Voro::build_container)
    .function("gl_build", &Voro::gl_build)
    .function("gl_vertices", &Voro::gl_vertices)
    .function("gl_tri_count", &Voro::gl_tri_count)
    .function("gl_max_tris", &Voro::gl_max_tris)
    .function("cell_count", &Voro::cell_count)
    .function("toggle_cell", &Voro::toggle_cell)
    .function("cell_neighbor_from_vertex", &Voro::cell_neighbor_from_vertex)
    .function("cell_from_vertex", &Voro::cell_from_vertex)
//    .property("min", &Voro::b_min)
//    .property("max", &Voro::b_max)
    ;
//    class_<Cell>("Cell")
//    .constructor<>()
//    .constructor<int, glm::vec3>()
//    .property("type", &Cell::type)
//    .property("pos", &Cell::pos)
//    ;
//    register_vector<Cell>("VectorCell");

}
