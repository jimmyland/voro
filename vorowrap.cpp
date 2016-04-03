// this will be a wrapper around voro++ functionality, helping exposing it to js (and threejs specifically)

#include <iostream>

#ifdef EMSCRIPTEN
#include <emscripten.h>
#endif

#include "voro/voro++.hh"

using namespace std;

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

// placeholder test of accessing+editing memory
extern "C" int randomPoints(int maxPts, float *mem, float low, float high) {
    float range = high-low;
    for (int i=0; i<maxPts; i++) {
        mem[i*3+0] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
        mem[i*3+1] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
        mem[i*3+2] = range*(float(rand() % RAND_MAX) / float(RAND_MAX))+low;
    }
    return maxPts;
}

// main is called once emscripten has asynchronously loaded all it needs to call the other C functions
// so we wait for its call to run the js init
int main() {
    emscripten_run_script("init();");
}
