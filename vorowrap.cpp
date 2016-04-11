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
    vector<int> tri_inds; // inds of tri
    CellCache cache;
    
    // todo: also add mapping btwn tris and voronoi cell faces?
};

struct GLBufferManager {
    float *vertices, *normals;
    int len, maxLen;
    int *cell_inds; // map from tri indices to cell indices
    
    vector<CellToTris*> info;
    
    GLBufferManager() : vertices(0), normals(0), len(0), maxLen(0), cell_inds(0) {}
    GLBufferManager(int numCells, int triCapacity) : len(0) {
        vertices = new float[triCapacity*3];
        normals = new float[triCapacity*3];
        cell_inds = new int[triCapacity];
        
        info.resize(numCells, 0);
    }
    
    void clear() {
        delete [] vertices;
        delete [] normals;
        delete [] cell_inds;
        vertices = normals = 0;
        cell_inds = 0;
        len = maxLen = 0;
        
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
    
    int compute_whole_vertex_buffer_fresh(int max_pts_output, float *vertices) {
        if (!con) {
            build_container();
        }
        
        voro::voronoicell_neighbor c;
        CellCache cache;
        int output_i = 0;
        assert(cells.size()==links.size());
        for (size_t i=0; i < cells.size(); i++) {
            auto &cell = cells[i];
            if (cell.type==1) {
                auto &link = links[i];
                con->compute_cell(c, link.ijk, link.q);
                cache.create(cell.pos, c);
                add_to_buffer(cache, i, max_pts_output, vertices, output_i);
            }
        }
        return output_i;
    }
    int compute_whole_vertex_buffer_fresh_embind_is_stupid_version(int max_pts_output, uintptr_t vertices_float_p) {
        float* ptr = reinterpret_cast<float*>(vertices_float_p);
        return compute_whole_vertex_buffer_fresh(max_pts_output, ptr);
    }
    
    void add_cell(glm::vec3 pt, int type) {
        int id = int(cells.size());
        cells.push_back(Cell(pt, type));
        if (con) {
            CellConLink link;
            con->put(id, pt.x, pt.y, pt.z, link.ijk, link.q);
            links.push_back(link);
            assert(cells.size() == links.size());
            
            // todo: update caches + buffers too, or at least mark as dirty
        }
    }

private:
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
    
    

    int add_to_buffer(const CellCache &c, int myid, int max_pts_output, float *output, int &output_i) {
        for (int i = 0, ni = 0; i < (int)c.faces.size(); i+=c.faces[i]+1, ni++) { // iterate over voronoi faces
            //if (myid > c.neighbors[ni] && [we actually want the face]) // neighbor conditional skipped for now
            {
                // make a fan of triangles to cover the face
                int vicount = (i+c.faces[i]+1)-(i+1);
                int firstv = c.faces[i+1];
                int prevv = c.faces[i+2];
                for (int j = i+3; j < i+c.faces[i]+1; j++) { // facev
                    int nextv = c.faces[j];
                    
                    output_vert_and_incr(output, output_i, c.vertices, firstv, max_pts_output);
                    output_vert_and_incr(output, output_i, c.vertices,  nextv, max_pts_output);
                    output_vert_and_incr(output, output_i, c.vertices,  prevv, max_pts_output);
                    prevv = nextv;
                }
            }
        }
        return output_i;
    }
    bool output_vert_and_incr(float *output_v, int &output_i, const vector<double> &input_v, int input_i, int max_pts_output) {
        if (output_i >= max_pts_output) return false;
        for (int ii=0; ii<3; ii++) {
            output_v[output_i*3+ii] = input_v[input_i*3+ii];
        }
        output_i++;
        return true;
    }

};

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
    .function("compute_whole_vertex_buffer_fresh", &Voro::compute_whole_vertex_buffer_fresh_embind_is_stupid_version, allow_raw_pointers())
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
