THREE.BufferGeometry.prototype.computeBoundingSphere = ( function () {

    var box = new THREE.Box3();
    var vector = new THREE.Vector3();

    return function () {

        if ( this.boundingSphere === null ) {

            this.boundingSphere = new THREE.Sphere();

        }

        var positions = this.attributes.position.array;

        if ( positions ) {

            var center = this.boundingSphere.center;

            box.setFromArray( positions );
            box.center( center );

            // hoping to find a boundingSphere with a radius smaller than the
            // boundingSphere of the boundingBox: sqrt(3) smaller in the best case

            var maxRadiusSq = 0;

            var drawRangeFac = 1;
            if (material && material.wireframe) {
                drawRangeFac = .5;
            }
            for ( var i = geometry.drawRange.start*3*drawRangeFac, il = Math.min(positions.length,(geometry.drawRange.count*drawRangeFac)*3); i < il; i += 3 ) {

                vector.fromArray( positions, i );
                maxRadiusSq = Math.max( maxRadiusSq, center.distanceToSquared( vector ) );

            }

            this.boundingSphere.radius = Math.sqrt( maxRadiusSq );

            if ( isNaN( this.boundingSphere.radius ) ) {

                console.error( 'THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this );

            }

        }

    };

}()  );
