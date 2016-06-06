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

            
            var start = this.drawRange.start*3, end = Math.min(positions.length,(this.drawRange.count)*3);;
            for ( var i = start; i < end; i += 3 ) {

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
