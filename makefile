# usr local bin exported for emcc because I couldn't find the setting in xcode to make it include /usr/local/bin in its path when running make; todo remove the export stuff later
CC=export PATH=/usr/local/bin/:$PATH && emcc
SOURCES:=$(wildcard *.cpp) voro++/voro++.cc
EXPORTS_FILE=makefile_exports.txt
LDFLAGS=-O2 --llvm-opts 2
OUTPUT=vorowrap.js

all: $(SOURCES) $(OUTPUT)

$(OUTPUT): $(SOURCES) makefile_exports.txt
	$(CC) $(SOURCES) --bind -s NO_EXIT_RUNTIME=1 -s ASSERTIONS=1 -s DEMANGLE_SUPPORT=1 -s EXPORTED_FUNCTIONS=@$(EXPORTS_FILE) -std=c++11 $(LDFLAGS) -o $(OUTPUT)

.PHONY: clean all
clean:
	rm $(OUTPUT) $(OUTPUT).mem
