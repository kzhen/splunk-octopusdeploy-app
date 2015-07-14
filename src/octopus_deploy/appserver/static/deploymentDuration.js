require.config({
  paths: {
    lodash: '../app/octopus_deploy/bower_components/lodash/lodash.min',
    d3v3: '../app/octopus_deploy/bower_components/d3/d3.min',
    nvd3: '../app/octopus_deploy/bower_components/nvd3/build/nv.d3.min',
  },
  shim: {
    lodash: {
      deps: []
    },
    d3v3: {
      deps: []
    },
    nvd3: {
      deps: ['d3v3']
    }
  }
});

// workaround for nvd3 using global d3
define('d3.global', ['d3v3'], function(_) {
  d3 = _;
});

require([
  'underscore',
  'util/moment',
  "splunkjs/ready!",
  "splunkjs/mvc/simplexml/ready!",
  "splunkjs/mvc/searchmanager",
  "d3v3",
  "nvd3",
  "lodash"
], function(_, moment, ready, simpleXmlReady, searchManager, d3, nv1, __) {

  //Load v3
  require("nvd3");

  var mainSearch = splunkjs.mvc.Components.getInstance("durationGroupedSearch");

  var results = mainSearch.data("preview", {});

  results.on("data", function() {
    if (results.hasData()) {

      var series = [];

      var data = _.pluck(results.collection().models, 'attributes');

      var item = {};
      item.key = "Duration";
      item.values = _.sortBy(data, 'durationInSecs');
      series.push(item);

      var chart;
      nv.addGraph(function() {
        chart = nv.models.multiBarChart();
        // chart = nv.models.historicalBarChart()
          // .useInteractiveGuideline(true)


        chart
        .duration(300)
        .rotateLabels(-45)
        // .groupSpacing(0.1)
          .x(function(d) {
            return d.durationInSecs;
          })
          .y(function(d) {

            return parseInt(d.count);
          });


          chart.yAxis.tickFormat(function(d) {
            return d3.format('d')(d);
          });

        chart.xAxis
          .axisLabel("Time (s)");
        //  .tickFormat(d3.format(',.1f'));

        chart.yAxis
          .axisLabel('Deployments');
          //.tickFormat(d3.format(',.2f'));

        chart.showXAxis(true);

        d3.select('#byDurationChart')
          .datum(series)
          .transition()
          .call(chart);

        nv.utils.windowResize(chart.update);

        return chart;
      });


    }
  });

});
