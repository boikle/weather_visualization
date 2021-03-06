/* 
 * Name: weathervisualizer.js
 * ------------------------------------------------------------------------------
 * Description: d3js weather data visualization. Display's historical weather 
 * data on air temp, barometric pressure and wind speed from three weather stations 
 * near Clyde River, Nunavut.
 * ------------------------------------------------------------------------------
 */

;(function($,$n2,$d){
    //"use strict";
    
    // Localization
    var _loc = function(str,args){ return $n2.loc(str,'nunaliit2-couch',args); };
    
    var DH = 'WeatherDataVisualizer'; 
    
    //--------------------------------------------------------------------------
    var WeatherDataVisualizer = $n2.Class('WeatherDataVisualizer', {
        
        containerId: null,
        dataset: null,
        csvFiles: null,
        csvFileIndex: 0,
        dispatchService: null,
        width: null,
        height: null,
        minSVGHeight: 610,
        minSVGWidth: 825,
        svgPadding: 10,
        
        initialize: function(opts_){
    
            var opts = $n2.extend({
                containerId: null
                ,config: null
                ,options: null
                ,widgetOptions: null
            },opts_);
            
            var _this = this;

            // Define initial structure of the dataset
            this.dataset = {
                filtered: [],
                original: [],
                statistics: {}
            };

            // Create a new Weather Data Tools object
            // Used for various data processing tasks
            this.dataTools = new WeatherDataTools();

            if( opts.config && opts.config.directory && opts.config.directory.dispatchService){

                this.dispatchService = opts.config.directory.dispatchService;

                // Register with dispatch service
                var f = function(m, addr, dispatcher){
                    _this._handle(m, addr, dispatcher);
                };
    
                this.dispatchService.register(DH, 'windowResized', f);
                this.dispatchService.register(DH, 'nextCSVDataset', f);
                this.dispatchService.register(DH, 'prevCSVDataset', f);
                this.dispatchService.register(DH, 'updateFilterDateRange', f);

            } else {
                throw new Error('Dispatch Service must be specified');
            };

            if( opts.widgetOptions ){ 

                if ( opts.widgetOptions.containerId ){
                    this.containerId = "#" + opts.widgetOptions.containerId;

                    // if containerId is defined, than calculate svg width and height values
                    this._getWindowHeight();
                    this._getWindowWidth();

                } else {
                    throw new Error('containerId must be specified in widget options');
                };
                
                if( opts.widgetOptions.csvFiles ){
                    this.csvFiles = opts.widgetOptions.csvFiles;

                    // initiate visualization dataset with first supplied csv file
                    this._loadCSVDataset(this.csvFiles[this.csvFileIndex].data);

                } else {
                    throw new Error('weather station CSV data not specified')
                };
            };

            $n2.log("Weather Station Data Visualizer: ", this);
        },

        _getWindowWidth: function(){
            // Gey width for the container element
            var $containerWidth = $(this.containerId).width();
            var svgPadding = this.svgPadding * 2;

            if ( ($containerWidth - svgPadding) < this.minSVGWidth ){
                this.width = this.minSVGWidth;
            } else {
                this.width = $containerWidth - svgPadding;
            };
        },

        _getWindowHeight: function(){
            // Get height for the container element
            var $containerHeight = $(this.containerId).height();
            var svgPadding = this.svgPadding * 2;

            if ( ($containerHeight - svgPadding) < this.minSVGHeight ){
                this.height = this.minSVGHeight;
            } else {
                this.height = $containerHeight - svgPadding;
            };            
        },

        _getCSVFileIndex: function(){
            return this.csvFileIndex;
        },

        _setCSVFileIndex: function(indexChange){
            var numOFCSVFiles = this.csvFiles.length;
            var currentIndex = this._getCSVFileIndex();

            if( (currentIndex + indexChange) >= numOFCSVFiles ){
                this.csvFileIndex = 0;

            } else if ((currentIndex + indexChange) < 0){
                this.csvFileIndex = numOFCSVFiles - 1;
            } else {
                this.csvFileIndex = currentIndex + indexChange;
            };
        },

        _nextDataset: function(){
            this._setCSVFileIndex(1);
            var fileName = this.csvFiles[this._getCSVFileIndex()].data;

            this._loadCSVDataset(fileName);
        },

        _prevDataset: function(){
            this._setCSVFileIndex(-1);
            var fileName = this.csvFiles[this._getCSVFileIndex()].data;

            this._loadCSVDataset(fileName);
        },

        _filterDateRange: function(){
            var _this = this;

            var filteredDataset = this.dataset.original.filter(function(row) {
                var rowDate = row.date.valueOf();
                if( rowDate >= _this.dataset.statistics.filterStartDate && rowDate <= _this.dataset.statistics.filterEndDate){
                    return row;
                };
            });

            var updatedDataset = {
                filtered: filteredDataset
            };

            this._updateDataset(updatedDataset);

        },

        _updateDateRange: function(dateRanges){
            // Update minDate statistic
            if( dateRanges.minDate ) this.dataset.statistics.minDate = dateRanges.minDate;
            // Update maxDate statistic
            if( dateRanges.maxDate ) this.dataset.statistics.maxDate = dateRanges.maxDate;
            // Update filterStartDate statistic
            if( dateRanges.filterStartDate ) this.dataset.statistics.filterStartDate = dateRanges.filterStartDate;
            // Update filterEndDate statistic
            if( dateRanges.filterEndDate ) this.dataset.statistics.filterEndDate = dateRanges.filterEndDate;
        },

        _updateDataset: function(updatedDataset){
            // Update original dataset
            if( updatedDataset.original ) this.dataset.original = updatedDataset.original;
            // Update filtered dataset
            if( updatedDataset.filtered ) this.dataset.filtered = updatedDataset.filtered;

            // Massage filtered datasets:
            // ----------------------------------------------------------
            // Re-calculate averages for air temp, wind speed, and pressure values
            var filteredData = this.dataset.filtered;
            this.dataset.statistics["avg_temp_air"] = this.dataTools.calcAvg(filteredData, "temp_air");
            this.dataset.statistics["avg_kmperhour_wind_speed"] = this.dataTools.calcAvg(filteredData, "kmperhour_wind_speed");
            this.dataset.statistics["avg_kilopascal"] = this.dataTools.calcAvg(filteredData, "kilopascal");
            // Classify wind dirs for Wind Rose
            this.dataset.statistics["wind_rose"] = this.dataTools.classifyWindDirs(filteredData);

            this._drawVisualization();
        },

        _loadCSVDataset: function(csvFile){
            var _this = this;

            $d.csv(csvFile, function(d){
                var dataset = {};
                // filter out all rows with null air temperture, wind speed and barometric pressure values from the dataset
                var originalDataset = d.filter(function(d) {
                    var noDataValue = "-9999";
                    if( d.temp_air !== noDataValue && d.pressure !== noDataValue && d.wind_speed !== noDataValue ){
                        return d;
                    };
                });

                // Convert dates, pressure and wind speed. 
                originalDataset = _this.dataTools.convertDates(originalDataset);
                originalDataset = _this.dataTools.convertPressure(originalDataset);
                originalDataset = _this.dataTools.convertWindSpeed(originalDataset);

                // Calculate the initial date range of the entire dataset 
                // and then updated the date range
                var initialDateRange = _this.dataTools.calcDateRange(originalDataset);
                _this._updateDateRange(initialDateRange);                

                dataset = {
                    original: originalDataset,
                    filtered: originalDataset
                };

                _this._updateDataset(dataset);
            });
        },
        
        _addGradientDefinition: function(){
            // Define and add a fill gradient for use by the line graph
            var svg = $d.select(this.containerId + ' svg');

            // Add a defs element if it doesn't exist
            if( svg.select('defs').empty() ){
                svg.append('defs');
            };

            var defs = svg.select('defs');

            if( defs.select('#areaFillGradient').empty() ){
                // Add linear gradient to defs element
                var linearGradient = defs.append('linearGradient')
                    .attr('id','areaFillGradient')
                    .attr("x1",'0%')
                    .attr("y1",'0%')
                    .attr("x2",'0%')
                    .attr('y2','100%');

                linearGradient.append('stop')
                    .attr('offset', '0%')
                    .attr('stop-opacity', 0.8)
                    .attr('stop-color', '#0191c7');

                linearGradient.append('stop')
                    .attr('offset', '100%')
                    .attr('stop-opacity', 0)
                    .attr('stop-color', '#0191c7');
            };
        },

        // Draw Weather Visualization
        _drawVisualization: function(){

            // If svg already exists remove it before creating a new one
            if (!$d.select(this.containerId + ' svg').empty() ){
                $d.select('svg').remove();
            };
    
            // Add svg to container 
            var svg = $d.select(this.containerId)
                .append('svg')
                    .attr('id', 'weather_data_visualization')
                    .attr('width', this.width)
                    .attr('height', this.height)
                    .attr("transform", "translate(" + this.svgPadding + "," + this.svgPadding + ")");
    
            // Add gradient definition
            this._addGradientDefinition();
            
            var lineGraphTopMargin = 20;
            var previousLineGraphBottomPadding = 45;
            var lineGraphLeftMargin = 385;
            var navBarHeight = 50;
            
            // --------------------------------------------------
            // Add line graphs to the svg
            var airTempGraphProperties = {
                containerId: this.containerId,
                dataset: this.dataset.filtered,
                dependentVar: "temp_air",
                dependentLabel: "Air Temp °C",
                dispatchService: this.dispatchService,
                width: this.width - lineGraphLeftMargin,
                height: ((this.height - navBarHeight)/3) - lineGraphTopMargin,
                leftMargin: lineGraphLeftMargin,
                topMargin: navBarHeight + lineGraphTopMargin
            };

            var windSpeedGraphProperties = {
                containerId: this.containerId,
                dataset: this.dataset.filtered,
                dependentVar: "kmperhour_wind_speed",
                dependentLabel: "Wind Speed km/hr",
                dispatchService: this.dispatchService,
                width: this.width - lineGraphLeftMargin,
                height: ((this.height - navBarHeight)/3) - lineGraphTopMargin,
                leftMargin: lineGraphLeftMargin,
                topMargin: lineGraphTopMargin + ((this.height - navBarHeight)/3) + previousLineGraphBottomPadding
            };

            var pressureGraphProperties = {
                containerId: this.containerId,
                dataset: this.dataset.filtered,
                dependentVar: "kilopascal",
                dependentLabel: "Pressure kPa",
                dispatchService: this.dispatchService,
                width: this.width - lineGraphLeftMargin,
                height: ((this.height - navBarHeight)/3) - lineGraphTopMargin,
                leftMargin: lineGraphLeftMargin,
                topMargin: lineGraphTopMargin + (((this.height - navBarHeight)/3)*2) + previousLineGraphBottomPadding
            };
    
            var tempGraph = new WeatherDataVisualizerLineGraph(airTempGraphProperties);
            var windSpeedGraph = new WeatherDataVisualizerLineGraph(windSpeedGraphProperties);
            var pressureGraph = new WeatherDataVisualizerLineGraph(pressureGraphProperties);

            // --------------------------------------------------
            // Create a new Wind Rose
            var windRoseParameters = {
                containerId: this.containerId,
                dispatchService: this.dispatchService,
                dataset: this.dataset.statistics.wind_rose
            };

            var windRose = new WindRose(windRoseParameters);

            // --------------------------------------------------
            // Create new control/display panels
            var controlPanelParameters = {
                containerId: this.containerId,
                dispatchService: this.dispatchService,
                csvFiles: this.csvFiles,
                csvFileIndex: this.csvFileIndex,
                datasetStatistics: this.dataset.statistics,
                width: this.width,
                navBarHeight: navBarHeight
            };
            
            var controlPanel = new WeatherDataController(controlPanelParameters);
        },

        _handle: function(m){
            if( 'windowResized' === m.type ){
                // Update svg width and height
                this._getWindowHeight(m);
                this._getWindowWidth(m);

                // Re-draw visualization
                this._drawVisualization();

            } else if( 'nextCSVDataset' === m.type ){
                // Update dataset with next one
                this._nextDataset();

            } else if( 'prevCSVDataset' === m.type ){
                // Update dataset with prev one
                this._prevDataset();

            } else if( 'updateFilterDateRange' === m.type ){
                var filterDateRanges = {
                    filterStartDate: m.filterStartDate,
                    filterEndDate: m.filterEndDate
                };
                this._updateDateRange(filterDateRanges);
                this._filterDateRange();

            };
        }   
    });

    var WeatherDataTools = $n2.Class('WeatherDataTools', {

        // Calculate the average value of a provided dataset dependent variable property
        calcAvg: function(dataset, dependentVar){
            var mean = $d.mean(dataset, function(d){
                return(d[dependentVar]);
            });

            return mean;
        },

        // Calculate the date range of a provided dataset
        calcDateRange: function(dataset){
            var dateRange = {};

            // Loop through all filtered data and identify start and end time range
            for( var i = 0, e = dataset.length; i < e; i++ ){

                var row = dataset[i];
                var dateValue = row.date.valueOf();

                if( dateRange.hasOwnProperty('filterStartDate') ){
                    if( dateRange.filterStartDate > dateValue ){
                        dateRange.filterStartDate = dateValue;
                        dateRange.minDate = dateValue;
                    };

                } else {
                    dateRange.filterStartDate = dateValue;
                    dateRange.minDate = dateValue;
                };

                if (dateRange.hasOwnProperty('filterEndDate')){
                    if ( dateRange.filterEndDate < dateValue ){
                        dateRange.filterEndDate = dateValue;
                        dateRange.maxDate = dateValue;
                    };

                } else {
                    dateRange.filterEndDate = dateValue;
                    dateRange.maxDate = dateValue;
                };

            };

            return dateRange;
        },

        // Convert temporal date properties in dataset into a date object
        convertDates: function(dataset){
            // Loop through all filtered data and add date objects based on temporal coloumn data
            for( var i = 0, e = dataset.length; i < e; i++ ){

                var row = dataset[i];
                if ( row.year && row.month && row.day && row.hour ){
                    var year = row.year;
                    var month = row.month -1; // month range = 0 - 11 
                    var day = row.day;
                    var hour = row.hour;
    
                    // Add date property to row containing a new date object
                    row.date = new Date(year, month, day, hour);
                };
            };
            return dataset;
        },

        // Convert pressure to hectopascal to kilopascale
        // A new property kilopascal contains the converted value
        convertPressure: function(dataset){

            for( var i = 0, e = dataset.length; i < e; i++ ){
                var row = dataset[i];
                var conversionFactor = 0.1;
                if ( row.pressure ) {
                    var hectopascal = row.pressure;
                    row.kilopascal = hectopascal * conversionFactor;
                };
            };
            return dataset;
        },

        // Convert wind speed from m/sec to km/sec
        // A new property kmperhour_wind_speed contains the converted value
        convertWindSpeed: function(dataset){
            for( var i = 0, e = dataset.length; i < e; i++ ){

                var row = dataset[i];
                var mPerSec = row.wind_speed;
                var conversionFactor = 3.6;

                row.kmperhour_wind_speed = mPerSec * conversionFactor;
            };
            return dataset;
        },

        // Generates the classification information needed for the wind rose
        classifyWindDirs: function(dataset){
            // Definie the initial structure of the wind rose classification
            // Contains the wind direction, and corresponding angles for the 
            // wind rose arc it will represent
            var windRoseClassification = [
                { dir:'N', count:0, startAngle: 6.086836, endAngle: 6.479535 },
                { dir:'NNE', count:0, startAngle: 0.1963495, endAngle: 0.5890486 },
                { dir:'NE', count:0, startAngle: 0.5890486, endAngle: 0.9817477 },
                { dir:'ENE', count:0, startAngle: 0.9817477, endAngle: 1.374447 },
                { dir:'E', count:0, startAngle: 1.374447, endAngle: 1.767146, },
                { dir:'ESE', count:0, startAngle: 1.767146, endAngle: 2.159845 },
                { dir:'SE', count:0, startAngle: 2.159845, endAngle: 2.552544 },
                { dir:'SSE', count:0, startAngle: 2.552544, endAngle: 2.945243 },
                { dir:'S', count:0, startAngle: 2.945243, endAngle: 3.337942 },
                { dir:'SSW', count:0, startAngle: 3.337942, endAngle: 3.730641 },
                { dir:'SW', count:0, startAngle: 3.730641, endAngle: 4.12334 },
                { dir:'WSW', count:0, startAngle: 4.12334, endAngle: 4.516039 },
                { dir:'W', count:0, startAngle: 4.516039, endAngle: 4.908739 },
                { dir:'WNW', count:0, startAngle: 4.908739, endAngle: 5.301438 },
                { dir:'NW', count:0, startAngle: 5.301438, endAngle: 5.694137 },
                { dir:'NNW', count:0, startAngle: 5.694137, endAngle: 6.086836 }
            ];

            // Increment count for specified wind direction
            function incrementWindDir(windDir){
                for( var i = 0; i < windRoseClassification.length; ++i){
                    if ( windRoseClassification[i].dir === windDir ){
                        ++windRoseClassification[i].count;
                        return;
                    };
                };
            };

            // Loop through all filtered data and classify wind directions
            for( var i = 0, e = dataset.length; i < e; i++ ){

                var row = dataset[i];
                var windDir = row.wind_direction.valueOf();
       
                // Classification of Wind Directions
                // 16 classes - each 22.5° ranges
                if( (windDir > 348.75 && windDir <= 360) || (windDir >= 0 && windDir <= 11.25) ) incrementWindDir('N');
                else if( windDir > 11.25 && windDir <= 33.75 ) incrementWindDir('NNE');
                else if( windDir > 33.75 && windDir <= 56.25 ) incrementWindDir('NE');
                else if( windDir > 56.25 && windDir <= 78.75 ) incrementWindDir('ENE');
                else if( windDir > 78.75 && windDir <= 101.25 ) incrementWindDir('E');
                else if( windDir > 101.25 && windDir <= 123.75 ) incrementWindDir('ESE');
                else if( windDir > 123.75 && windDir <= 146.25 ) incrementWindDir('SE');
                else if( windDir > 146.25 && windDir <= 168.75 ) incrementWindDir('SSE');
                else if( windDir > 168.75 && windDir <= 191.25 ) incrementWindDir('S');
                else if( windDir > 191.25 && windDir <= 213.75 ) incrementWindDir('SSW');
                else if( windDir > 213.75 && windDir <= 236.25 ) incrementWindDir('SW');
                else if( windDir > 236.25 && windDir <= 258.75 ) incrementWindDir('WSW');
                else if( windDir > 258.75 && windDir <= 281.25 ) incrementWindDir('W');
                else if( windDir > 281.25 && windDir <= 303.75 ) incrementWindDir('WNW');
                else if( windDir > 303.75 && windDir <= 326.25 ) incrementWindDir('NW');
                else if( windDir > 326.25 && windDir <= 348.75 ) incrementWindDir('NNW');
            };

            return windRoseClassification;
        }
    });

    var WeatherDataController = $n2.Class('WeatherDataController', {
        containerId: null,
        width: null,
        csvFiles: null,
        csvFileIndex: 0,
        datasetStatistics: null,
        dispatchService: null,
        navBarHeight: null,

        initialize: function(opts_){

            var opts = $n2.extend({
                containerId: null,
                width: null,
                csvFiles: null,
                csvFileIndex: null,
                datasetStatistics: null,
                dispatchService: null,
                navBarHeight: null
            },opts_);

            if( opts.dispatchService ){
                this.dispatchService = opts.dispatchService;
            } else {
                throw new Error('dispatchService not defined in line graph');
            };

            if( opts.containerId ){ 
                this.containerId = opts.containerId;
            };

            if( opts.navBarHeight ){ 
                this.navBarHeight = opts.navBarHeight;
            };

            if( opts.width ){ 
                this.width = opts.width;
            };

            if( opts.csvFiles ){ 
                this.csvFiles = opts.csvFiles;
            };

            if( opts.csvFileIndex ){ 
                this.csvFileIndex = opts.csvFileIndex;
            };

            if( opts.datasetStatistics ){ 
                this.datasetStatistics = opts.datasetStatistics;
            };

            // Add Navbar to container
            this._addDatasetNavbar();

            // Add display for averages
            this._addAvgDisplay();

            // Add Control Panel to container
            this._addControlPanel();
        },

        _addDatasetNavbar: function(){
            var _this = this;
            var svg = $d.select(this.containerId + ' svg');

            var datasetNavbar = svg.append('g')
                .attr('id','navbar');

            datasetNavbar.append('rect')
                .attr('id','navbar_background')
                .attr('x',0)
                .attr('y',0)
                .attr('width', this.width)
                .attr('height',this.navBarHeight);

            datasetNavbar.append('text')
                .attr('id', 'navbar_title')
                .attr('x', this.width/2)
                .attr('y', 35)
                .text(this.csvFiles[this.csvFileIndex].name);

            // Add nav-bar controls if more than one dataset is available
            if( this.csvFiles.length > 1 ){
            
                var leftArrow = datasetNavbar.append('path')
                    .attr('id','navbar_left_btn')
                    .attr('d','M5,25 25,5 25,10 15,25 25,40 25,45z')
                    .on('click', function(){
                        _this.dispatchService.synchronousCall(DH,{
                            type: 'prevCSVDataset'
                        });
                    });
    
                leftArrow.append('title')
                    .text(_loc("Previous"));

                var rightArrow = datasetNavbar.append('path')
                    .attr('id','navbar_right_btn')    
                    .attr('d','M'+(this.width-5) + ',25 ' + (this.width-25) + ',5 ' + (this.width-25) + ',10 ' + (this.width-15)+',25 '+(this.width-25)+',40 '+(this.width-25)+',45z')
                    .on('click', function(){
                        _this.dispatchService.synchronousCall(DH,{
                            type: 'nextCSVDataset'
                        });
                    });
    
                rightArrow.append('title')
                    .text(_loc("Next"));
            };
        },

        _addAvgDisplay: function(){
            var _this = this;
            var svg = $d.select(this.containerId + ' svg');

            var avgDisplay = svg.append('g')
                .attr('id','avg_display');

            avgDisplay.append('rect')
                .attr('class','panel_background')
                .attr('x',15)
                .attr('y',180)
                .attr('width', 300)
                .attr('height',90);

            // Title Bar and Label
            avgDisplay.append('rect')
            .attr('class','panel_title_background')
                .attr('x',15)
                .attr('y',180)
                .attr('width', 300)
                .attr('height',26);

            avgDisplay.append('text')
                .attr('class', 'panel_title')
                .attr('x', 25)
                .attr('y', 200)
                .text(_loc('Averages'));

            // Air Temperature
            avgDisplay.append('text')
                .attr('class', 'avg_display_label')
                .attr('x', 25)
                .attr('y', 221)
                .text(_loc('Air Temperature:'));

            avgDisplay.append('text')
                .attr('class', 'avg_display_value')
                .attr('x', 185)
                .attr('y', 221)
                .text(this.datasetStatistics.avg_temp_air.toFixed(2) + '°C');

            // Wind Speed
            avgDisplay.append('text')
                .attr('class', 'avg_display_label')
                .attr('x', 25)
                .attr('y', 241)
                .text(_loc('Wind Speed:'));
            
            avgDisplay.append('text')
                .attr('class', 'avg_display_value')
                .attr('x', 185)
                .attr('y', 241)
                .text(this.datasetStatistics.avg_kmperhour_wind_speed.toFixed(2) + 'km/hr');

            // Pressure
            avgDisplay.append('text')
                .attr('class', 'avg_display_label')
                .attr('x', 25)
                .attr('y', 261)
                .text(_loc('Pressure:'));

            avgDisplay.append('text')
                .attr('class', 'avg_display_value')
                .attr('x', 185)
                .attr('y', 261)
                .text(this.datasetStatistics.avg_kilopascal.toFixed(2) + 'kPa');

        },

        _addControlPanel: function(){          

            var svg = $d.select(this.containerId + ' svg');

            var dateRangePanel = svg.append('g')
                .attr('id','date_range');

            dateRangePanel.append('rect')
                .attr('class','panel_background')
                .attr('x',15)
                .attr('y',65)
                .attr('width', 300)
                .attr('height',105);

            // Title Bar and Label
            dateRangePanel.append('rect')
                .attr('class','panel_title_background')
                .attr('x',15)
                .attr('y',65)
                .attr('width', 300)
                .attr('height',26);

            dateRangePanel.append('text')
                .attr('class', 'panel_title')
                .attr('x', 25)
                .attr('y', 85)
                .text(_loc('Date Range'));

            // Remove HTML control panel elements if it already exists
            if( $(this.containerId + ' #control_panel').length ) $(this.containerId + ' #control_panel').remove();
            
            var _this = this;

            var controlPanel = $('<div>')
                .attr('id', 'control_panel')
                .appendTo(this.containerId);

            var slideRange = $('<div>')
                .attr('id', 'slide-range')
                .appendTo(controlPanel);

            slideRange.slider({
                range: true,
                min: this.datasetStatistics.minDate,
                max: this.datasetStatistics.maxDate,
                values:[this.datasetStatistics.filterStartDate, this.datasetStatistics.filterEndDate],
                slide: function( event, ui ){
                    dateMinValue.val(new Date(ui.values[0]).toLocaleString('en-GB'));
                    dateMaxValue.val(new Date(ui.values[1]).toLocaleString('en-GB'));
                },
                stop: function( event, ui ){
                    _this.dispatchService.synchronousCall(DH,{
                        type: 'updateFilterDateRange',
                        filterStartDate: ui.values[0],
                        filterEndDate: ui.values[1]
                    });
                }
            });

            var dateMin = $('<div>')
                .attr('id','date_min')
                .appendTo(controlPanel);
            
            $('<label>')
                .attr('class', 'range_label')
                .attr('for', 'minDateValue')
                .text(_loc('Start Date:'))
                .appendTo(dateMin);
            
            var dateMinValue = $('<input>')
                .attr('id', 'minDateValue')
                .attr('readonly', true)
                .val(new Date(this.datasetStatistics.filterStartDate).toLocaleString('en-GB'))
                .appendTo(dateMin);
            
            var dateMax = $('<div>')
                .attr('id','date_max')
                .appendTo(controlPanel);

            $('<label>')
                .attr('class', 'range_label')
                .attr('for', 'maxDateValue')
                .text(_loc('End Date:'))
                .appendTo(dateMax);

            var dateMaxValue = $('<input>')
                .attr('id', 'maxDateValue')
                .attr('readonly', true)
                .val(new Date(this.datasetStatistics.filterEndDate).toLocaleString('en-GB'))
                .appendTo(dateMax);
        }
    });

    //--------------------------------------------------------------------------
    var WeatherDataVisualizerLineGraph = $n2.Class('WeatherDataVisualizerLineGraph', {

        dataset: null,
        containerId: null,
        dependentVar: null,
        dependentLabel: null,
        leftMargin: null,
        topMargin: null,
        padding: {top: 0, right: 10, bottom: 45, left: 0},
        height: null,
        width: null,
        xScale: null,
        yScale: null, 
        xAxis: null,
        yAxis: null,
	    dispatchService: null,
        
        initialize: function(opts_){
    
            var opts = $n2.extend({
                dataset: null,
                containerId: null,
                leftMargin: null,
                topMargin: null,
                dispatchService: null
            },opts_);
            
            var _this = this;            
            this.height = opts.height - this.padding.top - this.padding.bottom;
            this.width = opts.width - this.padding.left - this.padding.right;
            
            if( opts.dispatchService ){
                this.dispatchService = opts.dispatchService;
            } else {
                throw new Error('dispatchService not defined in line graph');
            };

            if( opts.containerId ){ 
                this.containerId = opts.containerId;
            } else {
                throw new Error('ContainerId not provided for line graph');
            };

            if( opts.dataset ){ 
                this.dataset = opts.dataset;
            } else {
                throw new Error('Dataset not provided for line graph');
            };

            if( opts.dependentVar ){ 
                this.dependentVar = opts.dependentVar;
            } else {
                throw new Error('Dependent variable not provided for line graph');
            };

            if( opts.dependentLabel ){ 
                this.dependentLabel = opts.dependentLabel;
            } else {
                throw new Error('Dependent label not provided for line graph');
            };

            if( opts.leftMargin ){ 
                this.leftMargin = opts.leftMargin;
            } else {
                throw new Error('Left margin not provided for line graph');
            };

            if( opts.topMargin ){ 
                this.topMargin = opts.topMargin;
            } else {
                throw new Error('Top margin not provided for line graph');
            };

            // Define Scales
            this.xScale = this._defineXScale();
            this.yScale = this._defineYScale();

            // Define the Axis
            this.xAxis = this._defineXAxis();
            this.yAxis = this._defineYAxis();
    
            // Draw graph
            this._drawLineGraph();

            // Draw tool tips
            this._drawToolTip();
        },

        _defineXScale: function(){
            var xScale = $d.time.scale()
                .domain([ $d.min(this.dataset, function(d){
                    return d.date.valueOf()}), 
                    $d.max(this.dataset, function(d){
                    return d.date.valueOf()})
                    ])
                .range([this.padding.left, this.width]);

            return xScale;
        },

        _defineYScale: function(){
            var _this = this;

            var yScale = $d.scale.linear()
                .domain([$d.max(this.dataset, function(d){
                    return parseFloat(d[_this.dependentVar])}),
                    $d.min(this.dataset, function(d){
                    return parseFloat(d[_this.dependentVar])})
                ])
                .range([this.padding.top, this.height]);

            return yScale;
        },

        _defineXAxis: function(){
            var xAxis = $d.svg.axis()
                .scale(this.xScale)
                .ticks(6)
                .tickFormat(d3.time.format("%d/%m/%y"))
                .orient("bottom");
            
            return xAxis;
        },

        _defineYAxis: function(){
            var yAxis = $d.svg.axis()
                .scale(this.yScale)
                .ticks(5)
                .orient("left");

            return yAxis;
        },

        _drawToolTip: function(){
            var _this = this;
            var graphId = _this.dependentVar + "_graph";
            var lineGraph = $d.select("#" + graphId );

            // Add Bisect function for date vales 
            var bisectDate = $d.bisector(function(d) { return d.date; }).left;

            // Anchor Position function
            var calcLabelAnchor = function(d){
                var threshold = 120; // Min distance from the right edge

                // If mouse is near the far right edge, switch anchor from start to end
                if ( threshold > (_this.width - _this.xScale(d.date)) ){
                    return "end";
                } else {
                    return "start";
                };
            };

            var onMouseMovement = function(){

                function getDependentVarUnits(){
                    if ( _this.dependentVar  === "temp_air" ) return " °C";
                    else if ( _this.dependentVar  === "kmperhour_wind_speed" ) return " km/hr";
                    else if ( _this.dependentVar  === "kilopascal" ) return " kPa";
                };

                // Get the date based on the mouse x position
                var mouseXDate = _this.xScale.invert($d.mouse(this)[0] - _this.leftMargin);

                // Get index of the date based on mouse x position 
                var i = bisectDate(_this.dataset, mouseXDate, 1);

                // Get the index of previous date and next date based on the index value
                var prevDate = _this.dataset[i - 1];
                var nextDate = _this.dataset[i];

                // Select record based on the closest date value to the mouse x position
                var d = mouseXDate - prevDate.date > nextDate.date - mouseXDate ? nextDate : prevDate;

                // Update tool tip marker location
                toolTip.select('#' + graphId + '_tool_tip_marker')
                    .attr("transform", "translate(" + (_this.xScale(d.date) + _this.leftMargin) + "," + (_this.yScale(d[_this.dependentVar]) + _this.topMargin ) + ")");

                // Update the tool tip text content and location
                toolTip.select('#' + graphId + '_tool_tip_label_date')
                    .attr("transform", "translate(" + (_this.xScale(d.date) + _this.leftMargin) + "," + (_this.yScale(d[_this.dependentVar]) + _this.topMargin ) + ")")
                    .text(d.date.toLocaleString('en-GB'))
                    .attr('text-anchor', calcLabelAnchor(d));

                // Update the tool tip text content and location
                toolTip.select('#' + graphId + '_tool_tip_label_dependent')
                    .attr("transform", "translate(" + (_this.xScale(d.date) + _this.leftMargin) + "," + (_this.yScale(d[_this.dependentVar]) + _this.topMargin ) + ")")
                    .text(parseFloat(d[_this.dependentVar]).toFixed(2) + getDependentVarUnits())
                    .attr('text-anchor', calcLabelAnchor(d));
            };

            // Remove tool tip group if it already exists
            if( $('svg #line_graph_tool_tips').length ) $('svg #line_graph_tool_tips').remove();

            // Define rectanglar mask, which hides/shows tooltip based on mouse activity
            lineGraph.append('rect')
                .attr('class', 'tool_tip_cover')
                .attr('width', _this.width)
                .attr('height', _this.height)
                .attr('x', _this.leftMargin)
                .attr('y', _this.topMargin)
                .on('mouseover', function() { toolTip.style('display', null); })
                .on('mouseout', function() { toolTip.style('display', 'none'); })
                .on('mousemove', onMouseMovement);


            var toolTip = lineGraph.append('g')
                .attr('id', graphId + '_tool_tips')
                .style('display', 'none');

            toolTip.append('circle')
                .attr('id', graphId + '_tool_tip_marker')
                .attr('class','tool_tip_marker')
                .attr('r', 5);
            
            // Date Label
            toolTip.append('text')
                .attr('id', graphId + '_tool_tip_label_date')
                .attr('class','tool_tip_label')
                .attr('dx', 0)
                .attr('dy', '-1.7em');

            // Dependent Variable Label
            toolTip.append('text')
                .attr('id', graphId + '_tool_tip_label_dependent')
                .attr('class','tool_tip_label')
                .attr('dx', 0)
                .attr('dy', '-0.7em');
        },

        _drawLineGraph: function(){
            var _this = this;
            var svg = $d.select(this.containerId + ' svg');

            // Initial height of line at the x-axis
            // Used for transition
            var startLine = $d.svg.line()
                .x(function(d) { 
                    return _this.xScale(d.date); 
                })
                .y(function(d) { 
                    return _this.height; 
                });

            // Initial height of area at the x-axis
            // Used for transition
            var startArea = d3.svg.area()
                .x(function(d) { 
                    return _this.xScale(d.date); 
                })
                .y0(function(d) {
                    return _this.height; 
                })	
                .y1(function(d) { 
                    return _this.height;
                });

            var line = $d.svg.line()
                .x(function(d) { 
                    return _this.xScale(d.date); 
                })
                .y(function(d) { 
                    return _this.yScale(parseFloat(d[_this.dependentVar])); 
                });

            var	area = d3.svg.area()	
                .x(function(d) { 
                    return _this.xScale(d.date); 
                })
                .y0(function(d) {
                     return _this.height; 
                })	
                .y1(function(d) { 
                    return _this.yScale(parseFloat(d[_this.dependentVar])); 
                });

            var lineGraph = svg.append("g")
                .attr("id", _this.dependentVar + "_graph");
            
            // Add path of line graph
            lineGraph.append("path")
                .datum(_this.dataset)
                .attr("class", "line")
                .attr("transform", "translate(" + _this.leftMargin + "," + _this.topMargin + ")")
                .attr("d", startLine)
                .transition()
                    .duration(1000)
                    .attr("d", line);
    
            // Add area of line graph
            lineGraph.append("path")
                .datum(_this.dataset)
                .attr("class", "area")
                .attr('fill','url(#areaFillGradient)')
                .attr("transform", "translate(" + _this.leftMargin + "," + _this.topMargin + ")")
                .attr("d", startArea)
                .transition()
                    .duration(1000)
                    .attr("d", area);

            // Add y axis to graph
            var yAxis = lineGraph.append("g")
                .attr("class", _this.dependentVar + "_axis axis")
                .attr("transform", "translate(" + parseInt(_this.padding.left + _this.leftMargin) + "," + _this.topMargin + ")")
                .call(this.yAxis)

            // Added yAxis Label
            yAxis.append("text")
                .text(_this.dependentLabel)
                .attr("class","axis_label")
                .attr("x",0-(_this.height/2))
                .attr("y",-40)
                .attr("transform", "rotate(270)");

            // Add x axis to graph
            var xAxis = lineGraph.append("g")
                .attr("class", _this.dependentVar + "_axis axis")
                .attr("transform", "translate(" + _this.leftMargin + "," + parseInt(_this.topMargin + _this.height) + ")")
                .call(this.xAxis);

            // Added xAxis label
            xAxis.append("text")
                .text("Date")
                .attr("class","axis_label")
                .attr("x",_this.width/2)
                .attr("y",40);
        }
    });

    //--------------------------------------------------------------------------
    var WindRose = $n2.Class('WindRose', {

        dataset: null,
        containerId: null,
        yOrigin: 305,
        xOrigin: 15,
        radius: 150,
        padding: 20,
        scale: null,
        dispatchService: null,
        
        initialize: function(opts_){
    
            var opts = $n2.extend({
                dataset: null,
                containerId: null,
                topMargin: null,
                dispatchService: null
            },opts_);
            
            var _this = this;
            
            if( opts.dispatchService ){
                this.dispatchService = opts.dispatchService;
            } else {
                throw new Error('dispatchService not defined in line graph');
            };

            if( opts.containerId ){ 
                this.containerId = opts.containerId;
            } else {
                throw new Error('ContainerId not provided for line graph');
            };

            if( opts.dataset ){ 
                this.dataset = opts.dataset;
                this.scale = this._defineScale();
            } else {
                throw new Error('Dataset not provided for line graph');
            };

            var svg = $d.select(this.containerId + ' svg');
            
            // Add group for wind rose
            this.windrose = svg.append('g')
                .attr('id','windrose');

            this.windrose.append('rect')
                .attr('class','panel_background')
                .attr('x', 15)
                .attr('y', 280)
                .attr('width', 300)
                .attr('height', 325);

            // Title Bar and Label
            this.windrose.append('rect')
            .attr('class','panel_title_background')
                .attr('x', 15)
                .attr('y', 280)
                .attr('width', 300)
                .attr('height', 26);

            this.windrose.append('text')
                .attr('class', 'panel_title')
                .attr('x', 25)
                .attr('y', 300)
                .text(_loc('Wind Direction Frequency'));

            // Display Wind Rose Axis
            this._displayWindRoseAxis();

            // Display Wind Rose
            this._displayWindRose();
        },

        _defineScale: function(){
            var _this = this;

            var windRoseScale = $d.scale.linear()
                .domain([$d.min(this.dataset, function(d){
                    return d.count}),
                    $d.max(this.dataset, function(d){
                    return d.count})
                ])
                .range([0, (this.radius - this.padding)]);

            return windRoseScale;
        },

        _displayWindRoseAxis: function(){

            // Add group for axis
            var axisGroup = this.windrose.append('g')
            .attr('id', 'wind_rose_axis')
            .attr('transform','translate(' + (this.radius + this.xOrigin) + ', ' + (this.radius + this.yOrigin) + ')');

            function drawDirectionCenterLines(rotation){
                axisGroup.append('line')
                    .attr('class','wind_rose_axis_line')
                    .attr('x1',0)
                    .attr('y1',-130)
                    .attr('x2',0)
                    .attr('y2',0)
                    .attr('transform', 'rotate(' + rotation + ' 0 0)');
            };

            function drawDirectionLabels(label, rotation){
                axisGroup.append('text')
                    .text(label)
                    .attr('class','wind_rose_axis_label')
                    .attr('x',0)
                    .attr('y',-135)
                    .attr('transform', 'rotate(' + rotation + ' 0 0)');
            };

            // Add all lines and labels to wind rose
            for ( var i = 0; i < this.dataset.length; ++i ){
                var rotationFactor = 22.5;
                drawDirectionCenterLines(i * rotationFactor);
                drawDirectionLabels(this.dataset[i].dir, i * rotationFactor);
            };

            axisGroup.append('circle')
                .attr('id', 'wind_rose_outeraxis')
                .attr('cx', 0)
                .attr('cy', 0)
                .attr('r', this.radius - this.padding);

            axisGroup.append('circle')
                .attr('id', 'wind_rose_inneraxis')
                .attr('cx', 0)
                .attr('cy', 0)
                .attr('r', (this.radius - this.padding)/2);         
        },

        _displayWindRose: function(){
            var _this = this;
            
            var arc = $d.svg.arc()
                .innerRadius(0)
                .startAngle(function(d){
                    return d.startAngle;
                })
                .endAngle(function(d){
                    return d.endAngle;
                });
            
            // Add group for arcs
            var arcsGroup = this.windrose.append('g')
                .attr('id', 'wind_rose_arcs')
                .attr('transform','translate(' + (this.radius + this.xOrigin) + ', ' + (this.radius + this.yOrigin) + ')');

                
            // Generate Arcs representing wind direction frequency
            arcsGroup.selectAll('path')
                .data(this.dataset)
                .enter()
                .append("path")
                .attr('class','wind_rose_arc')
                .each(function(d) { 
                    d.outerRadius = 0; 
                })
                .attr('d', arc)
                .transition()
                    .duration(1000)
                    .each(function(d) {
                        d.outerRadius = _this.scale(d.count);
                    })
                    .attr('d', arc);
        }
    });
    
    $n2.weather_data_visualizer_widget = {
        WeatherDataVisualizer:WeatherDataVisualizer
    };
    
})(jQuery,nunaliit2,d3);
