Plot.plot({
    projection: {
      // type: "azimuthal-equidistant",
      type: "equirectangular",
      rotate: [-90, 0],  
      domain: d3.geoCircle().center([80, 20]).radius(65)(),
    },
    width: 1100,
    height: 700,
    marks: [
      Plot.geo(land, { fill: "currentColor" }), // shade
      // Plot.graticule(),
      Plot.geo(countries, {
        fill: "#DDDDDD", // (d) => byName.get(d.properties.name)?.value,
        stroke: "currentColor",
        strokeWidth: 0.25,
        // title: (d) => `${d.properties.name}: ${byName.get(d.properties.name)?.value.toFixed(1) ?? "No data"}`
      }),
      Plot.dot(filtered_data, {
        x: "Long",
        y: "Lat",
        r: 2,// function() { return 500 }, //(valueToRadius(d["CC"])),
        fill: d => valueToColor(d["CC"]),
        stroke: "white",
        strokeWidth: 1
      }),
      Plot.link(filtered_data, {
        x: "Long",
        y: "Lat",
        x2: "Long2",
        y2: "Lat2",
        stroke: "red",
      }),
      Plot.dot(filtered_data, {
        x: "Long2",
        y: "Lat2",
        r: "Radius",// function() { return 500 }, //(valueToRadius(d["CC"])),
        fill: d => valueToColor(d["CC"]),
        stroke: "white",
        strokeWidth: 1
      }),
      Plot.text(filtered_data, {
        x: "Long2",
        y: "Lat2",
        text: (d) => d["CC"],
        title: "fa",
        fontSize: 10,
        fill: "black",
        stroke: "white",
        strokeWidth: 3,
        dy: 20,
      }),
      Plot.text(
        [{ x: 100, y: 100, text: "ur text here" }], 
        {x: "x", y: "y", text: "text"}
      ),
      // Plot.dot(data, Plot.centroid({
      //   x: "Long",
      //   y: "Lat",
      //   fill: "brown",
      //   fillOpacity: 0.5,
      //   stroke: "#fff",
      //   strokeOpacity: 0.5,
      //   // geometry: ({ state, county }) => countymap.get(`${state}${county}`),
      //   // channels: {
      //   //   county: ({ state, county }) => countymap.get(`${state}${county}`)?.properties.name,
      //   //   state: ({ state }) => statemap.get(state)?.properties.name
      //   // },
      //   tip: true
      // })),
      // Plot.graticule(),
      Plot.sphere()
    ]
  })