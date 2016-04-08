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

// placeholder test that we can call voro++ functions
int create_voro() {
    // Set up constants for the container geometry
    const double x_min=-2,x_max=2;
    const double y_min=-2,y_max=2;
    const double z_min=-2,z_max=2;
    // Set up the number of blocks that the container is divided
    // into
    const int n_x=7,n_y=7,n_z=7;
    
    voro::container con(x_min,x_max,y_min,y_max,z_min,z_max,n_x,n_y,n_z,false,false,false,8);
    con.put(0, 0, 0, 0);
    con.put(1, 1, 1, 1);
    con.put(2, -1, -1, -1);
    return 5;
}

// placeholder test of malloc
extern "C" void testMalloc() {
    void *mem = malloc(1000);
    free(mem);
}

bool output_vert_and_incr(float *output_v, int &output_i, vector<double> &input_v, int input_i, int max_pts_output) {
    if (output_i >= max_pts_output) return false;
    for (int ii=0; ii<3; ii++) {
        output_v[output_i*3+ii] = input_v[input_i*3+ii];
    }
    output_i++;
    return true;
}



// helper to create a vertex buffer for a voronoi diagram given a point set and bounds
// return num pts used in the vertex buffer
int createVoroHelper(float x_min, float x_max, float y_min, float y_max, float z_min, float z_max,
                     int numPts, float *points, int max_pts_output, float *output) {
    // put all the points in a pre_container
    voro::pre_container pcon(x_min,x_max,y_min,y_max,z_min,z_max,false,false,false);
    float *pt = points;
    for (int i=0; i<numPts; i++, pt+=3) {
        pcon.put(i++,pt[0],pt[1],pt[2]);
    }
    
    // Set up the number of blocks that the container is divided into
    int n_x=100,n_y=100,n_z=100;
    pcon.guess_optimal(n_x,n_y,n_z);
    
    // Set up the container class and import the particles from the
    // pre-container
    voro::container con(pcon.ax,pcon.bx,pcon.ay,pcon.by,pcon.az,pcon.bz,n_x,n_y,n_z,false,false,false,10);
    pcon.setup(con);
    
    voro::voronoicell_neighbor c;
    voro::c_loop_all vl(con);
    vector<int> facev;
    vector<double> vcoords;
//    vector<int> neighbors; // commented out code for tracking neighbor relations; kept for ref.; will prob use this in the future
    int count = 0, tmpcount = 0;
    int testneigh = -1, teststart = -1;
    int output_i = 0;
    if(vl.start()) do if(con.compute_cell(c,vl)) {
         
        
        double *pp = con.p[vl.ijk]+con.ps*vl.q;
        
        int myid = con.id[vl.ijk][vl.q];
        
        // todo remove -- for testing, just skip most of the cells (so we don't end up with a single solid block)
        if (rand() % 5 != 1) {
            continue;
        }
        
        
//        c.neighbors(neighbors);
        // fills facev w/ faces as (#verts in face 1, face vert ind 1, ind 2, ..., #vs in f 2, f v ind 1, etc)
        c.face_vertices(facev);
        // makes all the vertices for the faces to reference
        c.vertices(pp[0], pp[1], pp[2], vcoords);
        
        for (int i = 0, ni = 0; i < (int)facev.size(); i+=facev[i]+1, ni++) {
//            if (myid > neighbors[ni])
            {
//                connect(myid, neighbors[ni]);
                // triangulate each face of the voronoi diagram
                int vicount = (i+facev[i]+1)-(i+1);
                int firstv = facev[i+1];
                int prevv = facev[i+2];
                for (int j = i+3; j < i+facev[i]+1; j++) { // facev
                    int nextv = facev[j];
                    output_vert_and_incr(output, output_i, vcoords, firstv, max_pts_output);
                    output_vert_and_incr(output, output_i, vcoords, nextv, max_pts_output);
                    output_vert_and_incr(output, output_i, vcoords, prevv, max_pts_output);
                    prevv = nextv;
                }
            }
        }
    } while(vl.inc());
    
    return output_i;

}

// create a vertex buffer for a voronoi diagram given a point set and bounds
// return num pts used in the vertex buffer
extern "C" int createVoro(float x_min, float x_max, float y_min, float y_max, float z_min, float z_max,
                           int numPts, float *points, int max_pts_output, float *output) {
    return createVoroHelper(x_min, x_max, y_min, y_max, z_min, z_max,
                     numPts, points, max_pts_output, output);
    
}

// placeholder test of accessing+editing memory
extern "C" int randomPoints(int numPts, float *mem, float low, float high) {
    float range = high-low;
    for (int i=0; i<numPts; i++) {
        mem[i*3+0] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
        mem[i*3+1] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
        mem[i*3+2] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
    }
    return numPts;
}

// main is called once emscripten has asynchronously loaded all it needs to call the other C functions
// so we wait for its call to run the js init
int main() {
    emscripten_run_script("ready_for_emscripten_calls = true;");
}

// indices to connect cell to voro++ container
struct CellConLink {
    CellConLink() : ijk(-1), q(-1) {} // invalid / fail-fast defaults
    int ijk;    // block index in voro++ container
    int q;      // index of the cell within the block (following var naming from c_loops.hh)
};

// defining information about cell
struct Cell {
    Cell() {}
    Cell(int id, int type, glm::dvec3 pos) : id(id), type(type), pos(pos) {}
    int id; // id of the cell; e.g. what is return in neighbor queries.  By convention, should be kept as index of cell in cell vector.
    int type; // 0 is empty, non-zero is non-empty; can use different numbers as tags or material types
    glm::dvec3 pos;
    CellConLink link;
};

struct CellCache { // computations from a voro++ computed cell
    vector<int> faces; // faces as voro++ likes to store them -- packed as [#vs in f0, f0 v0, f0 v1, ..., #vs in f1, ...]
    vector<double> vertices; // vertex coordinates, indexed by faces array
    vector<int> neighbors; // cells neighboring each face
    
    void clear() { faces.clear(); vertices.clear(); neighbors.clear(); }
    void create(const glm::dvec3 &pos, voro::voronoicell_neighbor &c) {
        c.neighbors(neighbors);
        // fills facev w/ faces as (#verts in face 1, face vert ind 1, ind 2, ..., #vs in f 2, f v ind 1, etc)
        c.face_vertices(faces);
        // makes all the vertices for the faces to reference
        c.vertices(pos.x, pos.y, pos.z, vertices);
    }
};

struct CellGLBuffers {
    vector<float> vertices;
    vector<float> normals;
    
    float* getBuffer() { return &vertices[0]; }
    int getLen() { return vertices.size(); }
};

struct Voro {
    Voro() : b_min(glm::vec3(-10)), b_max(glm::vec3(10)), con(0) {}
    Voro(glm::vec3 bound_min, glm::vec3 bound_max) : b_min(bound_min), b_max(bound_max), con(0) {}
    ~Voro() {
        delete con;
    }
    
    union { // bounding box range
        struct {glm::vec3 b_min, b_max;};
        glm::vec3 bounds[2];
    };
    voro::container *con;
    vector<Cell> cells;
    vector<CellCache> cell_caches;
    vector<CellGLBuffers> cell_buffers;
    
    void buffersFromCellCache(int cell, const CellCache &cache, CellGLBuffers &buffers, int mode) {
        
    }
    
    void create(float *points, int *types, int numPts, bool computeCaches, bool computeBuffers) {
        // Put all the points in a pre_container
        voro::pre_container pcon(b_min.x,b_max.x,b_min.y,b_max.y,b_min.z,b_max.z,false,false,false);
        float *pt = points;
        for (int i=0; i<numPts; i++, pt+=3) {
            pcon.put(i++,pt[0],pt[1],pt[2]);
            cells.push_back(Cell(i, types[i], glm::vec3(pt[0],pt[1],pt[2])));
        }
        
        // Set up the number of blocks that the container is divided into
        int n_x, n_y, n_z;
        pcon.guess_optimal(n_x,n_y,n_z);
        
        // Set up the container class and import the particles from the pre-container
        con = new voro::container(pcon.ax,pcon.bx,pcon.ay,pcon.by,pcon.az,pcon.bz,n_x,n_y,n_z,false,false,false,10);
        pcon.setup(*con);
        
        voro::voronoicell_neighbor c;
        voro::c_loop_all vl(*con);
        CellCache cache;
//        int count = 0, tmpcount = 0;
//        int testneigh = -1, teststart = -1;
//        int output_i = 0;
//        if(vl.start()) do if(con.compute_cell(c,vl)) {
//            
//            
//            double *pp = con.p[vl.ijk]+con.ps*vl.q;
//            
//            int myid = con.id[vl.ijk][vl.q];
//            
//            // todo remove -- for testing, just skip most of the cells (so we don't end up with a single solid block)
//            if (rand() % 5 != 1) {
//                continue;
//            }
//            
//            
//            c.neighbors(neighbors);
//            // fills facev w/ faces as (#verts in face 1, face vert ind 1, ind 2, ..., #vs in f 2, f v ind 1, etc)
//            c.face_vertices(facev);
//            // makes all the vertices for the faces to reference
//            c.vertices(pp[0], pp[1], pp[2], vcoords);
//            
//            for (int i = 0, ni = 0; i < (int)facev.size(); i+=facev[i]+1, ni++) {
//                //            if (myid > neighbors[ni])
//                {
//                    //                connect(myid, neighbors[ni]);
//                    // triangulate each face of the voronoi diagram
//                    int vicount = (i+facev[i]+1)-(i+1);
//                    int firstv = facev[i+1];
//                    int prevv = facev[i+2];
//                    for (int j = i+3; j < i+facev[i]+1; j++) { // facev
//                        int nextv = facev[j];
//                        output_vert_and_incr(output, output_i, vcoords, firstv, max_pts_output);
//                        output_vert_and_incr(output, output_i, vcoords, nextv, max_pts_output);
//                        output_vert_and_incr(output, output_i, vcoords, prevv, max_pts_output);
//                        prevv = nextv;
//                    }
//                }
//            }
//        } while(vl.inc());

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
    .property("min", &Voro::b_min)
    .property("max", &Voro::b_max)
    ;

}
