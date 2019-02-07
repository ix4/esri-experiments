// TODO: outline main points
//  - JSAPI 4 and Chroma.js "luminance"
//  - custom 3D terrain layer
//  - 2D tiles draped over custom terrain
//  - custom feature layer with city label "callouts"
//  - put together list of JSAPI official samples and docs that inspired this
//  - this also opens up possibilities of other 3D terrain layers for thematic (gridded) data

require([
  'esri/core/promiseUtils',

  'esri/layers/BaseElevationLayer',
  'esri/layers/BaseTileLayer',
  'esri/layers/FeatureLayer',
  'esri/layers/WebTileLayer',

  'esri/Map',
  'esri/views/SceneView',

  'esri/widgets/Locate',
], function(
  promiseUtils,
  BaseElevationLayer, BaseTileLayer, FeatureLayer, WebTileLayer,
  Map, SceneView,
  Locate
) {
  // helper function that returns an instance of the Black Marble WebTileLayer
  // (it'll be reused by both the 3D ground terrain layer and the 2D layer draped on top)
  function createEarthAtNightWebTileLayer() {
    var earthAtNightTileLayer = new WebTileLayer({
      urlTemplate: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{level}/{row}/{col}.png',
      copyright: 'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (<a href="https://earthdata.nasa.gov">ESDIS</a>) with funding provided by NASA/HQ.'
    });

    // only tile zoom levels 1 through 8 exist, but not 0 or 9+
    // we remove levels that do not exist to block fetching those tiles
    earthAtNightTileLayer.tileInfo.lods.splice(0, 1);
    earthAtNightTileLayer.tileInfo.lods.splice(8);

    return earthAtNightTileLayer;
  }

  // TODO: pull this out into a separate module
  // this is the custom 3D ground terrain elevation layer class
  // internally, it also relies on the Black Marble WebTileLayer to calculate elevation values
  var EarthAtNight3DLayerClass = BaseElevationLayer.createSubclass({
    properties: {
      // add on custom properties
      exaggerationFactor: 85000
    },
    load: function() {
      this._earthAtNightLayer = createEarthAtNightWebTileLayer();
      
      // return this._earthAtNightLayer
      return this._earthAtNightLayer
        .load()
        .then(function() {
          // set the elevation layer's tileInfo to be equal to
          // the underlying WebTileLayer's modified tileInfo
          this.tileInfo = this._earthAtNightLayer.tileInfo;

          // TODO: is this necessary?
          // return promiseUtils.resolve();
        }.bind(this));
      
      // TODO: explain difference between what I'm doing above versus documented "addResolvingPromise"
      // this.addResolvingPromise(this._earthAtNightLayer.load());
    },
    fetchTile: function(level, row, col) {
      // fetch image tiles from the Black Marble WebTileLayer
      // and convert each pixel's "luminance" into elevation values
      return this._earthAtNightLayer.fetchTile(level, row, col)
        .then(function(imageElement) {
          var width = imageElement.width;
          var height = imageElement.height;

          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          var ctx = canvas.getContext('2d');
          ctx.drawImage(imageElement, 0, 0, width, height);

          var imageData = ctx.getImageData(0, 0, width, height).data;

          var elevations = [];

          for (var index = 0; index < imageData.length; index += 4) {
            var r = imageData[index];
            var g = imageData[index + 1];
            var b = imageData[index + 2];
            // opacity would be imageData[index + 3] but we don't need it

            var elevation = new chroma([r, g, b]).luminance();

            elevation *= this.exaggerationFactor;

            elevations.push(elevation);
          }

          return {
            values: elevations,
            width: width,
            height: height,
            noDataValue: -1
          };
        }.bind(this));
    }
  });
    
  // a utility black base layer class for SceneView and MapView adapted from @ycabon's codepen
  // https://codepen.io/ycabon/pen/gvXqqj?editors=1000
  // its purpose is to simply override the default graticule on the SceneView's globe
  var BlackLayerClass = BaseTileLayer.createSubclass({
    constructor: function() {
      var canvas = this.canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      var ctx = canvas.getContext('2d');
      ctx.fillRect(0, 0, 256, 256);
    },
    fetchTile: function() {
      return promiseUtils.resolve(this.canvas);
    }
  });
    
  // create layer instances and then create SceneView, Map, widgets, etc. 
  // - earthAtNight3DLayer
  // - earthAtNight2DLayer
  // - blackLayer
  // - citiesLayer

  // this instance of the Black Marble WebTileLayer will be draped over the SceneView's ground terrain as an operational layer
  var earthAtNight2DLayer = createEarthAtNightWebTileLayer();
  
  // this instance of the custom 3D ground terrain elevation layer will be provided to the SceneView's ground layers propertyBlack Marble WebTileLayer will be draped over the SceneView's ground terrain
  var earthAtNight3DLayer = new EarthAtNight3DLayerClass();

  var blackLayer = new BlackLayerClass();

  // this cities feature layer provides the labeled callouts
  // https://developers.arcgis.com/javascript/latest/sample-code/visualization-point-styles/index.html
  var citiesLayer = new FeatureLayer({
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/World_Cities/FeatureServer/0',
    elevationInfo: {
      mode: 'relative-to-ground'
    },
    returnZ: false,
    minScale: 25000000,
    definitionExpression: 'POP_RANK <= 6 OR STATUS LIKE \'%National%\'',
    outFields: ['CITY_NAME'],
    screenSizePerspectiveEnabled: true,
    featureReduction: {
      type: 'selection'
    },
    renderer: {
      type: 'simple',
      symbol: {
        // hide any kind of symbol showing up on the ground for the feature
        // because we're only intersted in the lable with a callout
        type: 'point-3d',
        symbolLayers: [{
          type: 'icon',
          size: 0
        }]
      }
    },
    labelingInfo: [{
      labelPlacement: 'above-center',
      labelExpressionInfo: {
        expression: '$feature.CITY_NAME'
      },
      symbol: {
        type: 'label-3d',
        symbolLayers: [{
          type: 'text',
          material: {
            color: 'black'
          },
          halo: {
            color: [255, 255, 255, 0.75],
            size: 1.75
          },
          size: 10
        }],
        verticalOffset: {
          screenLength: 10000,
          maxWorldLength: 50000,
          minWorldLength: 1000
        },
        callout: {
          type: 'line',
          size: 2,
          color: [255, 255, 255, 0.75]
        }
      }
    }]
  });

  var view = new SceneView({
    container: 'viewDiv',
    map: new Map({
      basemap: {
        baseLayers: [
          blackLayer,
        ]
      },
      ground: {
        layers: [
          earthAtNight3DLayer
        ]
      },
      layers: [
        earthAtNight2DLayer,
        citiesLayer
      ]
    }),
    camera: {
      position: {
        longitude: 24,
        latitude: 24,
        z: 650000
      },
      heading: 40,
      tilt: 55
    },
    environment: {
      atmosphere: {
        quality: 'high'
      }
    }
  });

  view.when(function(view) {
    var credits = document.getElementById('credits');
    view.ui.add(credits, 'bottom-right');
    credits.style.display = 'flex';

    // TODO: add a toggle to see satellite imagery draped over the custom ground terrain
    // and research if possible to animate to a "true" elevation ground terrain
    // view.map.basemap = 'satellite'
    // view.map.basemap.baseLayers.getItemAt(0).opacity = 0.5
    // earthAtNight2DLayer.opactiy = 0.5;
    // earthAtNight2DLayer.visible = false;

    // add a Locate widget and override its behavior
    // by zooming out to space and then in to the user's location
    view.ui.add(new Locate({
      view: view,
      graphic: null,
      goToOverride: function(view, goToParams) {
        var originalHeading = view.camera.clone().heading;

        return view.goTo({
          scale: 80000000,
          tilt: 0,
          heading: 0
        }, {
          speedFactor: 0.25
        })
          .then(function() {
            goToParams.target.tilt = 55;
            goToParams.target.scale = 650000;
            goToParams.target.heading = originalHeading;
            return view.goTo(goToParams.target, {
              speedFactor: 0.5
            });
          });
      }
    }), 'top-left');
  });
});
