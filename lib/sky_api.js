Sky.api = {
	youTube: {
		search: function(query, limit){
			limit = typeof limit !== 'undefined' ? limit : '20';
			return Meteor.http.get('https://www.googleapis.com/youtube/v3/search?part=id,snippet&q='+encodeURIComponent(query)+'&regionCode=US&videoEmbeddable=true&maxResults='+limit+'&type=video&key='+APIKeys.youtube).data;
		},
		videoInfo: function(video_id){
			var cacheCheck = Cache.YouTube.findOne({youtube_id: video_id});

			if ( cacheCheck ) {
				return cacheCheck.cacheData;
			} else {
				var videoInfo = Meteor.http.get('https://www.googleapis.com/youtube/v3/videos?part=id%2Csnippet%2CcontentDetails%2CtopicDetails&id='+video_id+'&maxResults=1&key='+APIKeys.youtube);
				Cache.YouTube.insert({youtube_id: video_id, cacheData: videoInfo.data.items[0]});
				return videoInfo.data.items[0];
			}
		},
		similarVideos: function(video_id){
			return Meteor.http.get('https://www.googleapis.com/youtube/v3/search?part=id&relatedToVideoId='+video_id+'&regionCode=US&videoEmbeddable=true&type=video&maxResults=15&key='+APIKeys.youtube).data;
		}
	},
	theEchoNest: {
		similarTracks: function(track_id, artist_id) {
      console.log(track_id,artist_id);
			var requestUrlTrack = 'http://developer.echonest.com/api/v4/playlist/static?api_key='+APIKeys.echonest+'&song_id=spotify:track:'+track_id+'&format=json&results=20&type=song-radio';
			var requestUrlArtist = 'http://developer.echonest.com/api/v4/playlist/static?api_key='+APIKeys.echonest+'&artist_id=spotify:artist:'+artist_id+'&format=json&results=20&type=artist-radio';

			var similarTracks = Meteor.http.get(requestUrlTrack);

			if ( similarTracks.data.response.status.code != 0 ) {
				similarTracks = Meteor.http.get(requestUrlArtist);
			}

			var similarList = similarTracks.data.response.songs;
			var thisArtist = similarList[0].artist_name;

			var didSwitch = false;

			similarList.forEach(function(item,i){
				if ( didSwitch == false && i > 0 ) {
					if ( item.artist_name == thisArtist ) {
						similarList.move(i, 1);
						didSwitch = true;
					}
				}
			});

			return similarTracks.data.response.songs;
		}
	},
	spotify: {
		search: function(query, limit){
			limit = typeof limit !== 'undefined' ? limit : '20';
			// Pending: look for songs with same artist+title combo and remove if dupe.
			return Meteor.http.get('https://api.spotify.com/v1/search?q='+encodeURIComponent(query)+'&type=track').data;
		},
		findWithArtist: function(track, artist){
			return Meteor.http.get('https://api.spotify.com/v1/search?q=track:'+encodeURIComponent(track)+'%20artist:'+encodeURIComponent(artist)+'&type=track&limit=1').data;
		},
		cacheArtistData: function(artist_id){
			var cacheCheck = Cache.Spotify.findOne({spotify_artist_id: artist_id});
			if ( cacheCheck ) {
				return cacheCheck.cacheData;
			} else {
				var data = Meteor.http.get('https://api.spotify.com/v1/artists/'+artist_id).data;
				Cache.Spotify.insert({spotify_artist_id: artist_id, cacheData: data});
			}
		},
		checkVideoForMusic: function(doc){
			// Check for cached YouTube object
			var trackInfo;
			var cacheCheck = Cache.YouTube.findOne({youtube_id: doc.youtube_id});

			// If cached object has a Spotify ID associated to it, go that way.
			if ( cacheCheck && cacheCheck.spotify_id ) {
				var spotifyTrackCache = Cache.Spotify.findOne({spotify_id: cacheCheck.spotify_id});
				trackInfo = spotifyTrackCache.cacheData;
			} else {
				if ( doc.youtube_info.topicDetails ) {
					if ( doc.youtube_info.topicDetails.topicIds ) {
						doc.youtube_info.topicDetails.topicIds.forEach(function(topic, i){
							if ( Sky.api.freebase.checkForRecording(topic) ) {
								var topicInfo = Sky.api.freebase.topicInfo(topic);
								var trackName = topicInfo.data.property['/type/object/name'].values[0].text;
								var artistName = topicInfo.data.property['/music/recording/artist'].values[0].text;

								var spotifySearch = Sky.api.spotify.findWithArtist(trackName, artistName);

								if ( spotifySearch.tracks.items.length > 0 )  {
									trackInfo = spotifySearch.tracks.items[0];

									var spotifyTrackCache = Cache.Spotify.findOne({spotify_id: trackInfo.id});

									if ( !spotifyTrackCache ) {
										Cache.Spotify.insert({spotify_id: trackInfo.id, cacheData: trackInfo});
									}

									Cache.YouTube.update({youtube_id: doc.youtube_id}, { $set: { spotify_id: trackInfo.id } });
								}
							}
						});
					}
				}
			}

			if ( typeof trackInfo !== 'undefined' ) {

				var cleanVideoTitle = cleanVideoName(doc.youtube_info.snippet.title, trackInfo.name, trackInfo.artists[0].name);

				var dataToUpdate = {
					title: trackInfo.name,
					artist_name: trackInfo.artists[0].name,
					subtitle: cleanVideoTitle,
					image_url: trackInfo.album.images[1].url,
					type: 'track',
					spotify_id: trackInfo.id,
					spotify_artist_id: trackInfo.artists[0].id,
					isAnalyzed: true
				}

				Videos.update({_id: doc._id}, { $set: dataToUpdate });

				Sky.api.spotify.cacheArtistData(dataToUpdate.spotify_artist_id);

			}

			Videos.update({_id: doc._id}, { $set: { isAnalyzed: true } });

			Sky.generateRecommendations(doc._id);
		}
	},
	freebase: {
		topicInfo: function(topic){
			var cacheCheck = Cache.Freebase.findOne({topic_id: topic});

			if ( cacheCheck ) {
				return cacheCheck.cacheData;
			} else {
				var topicInfo = Meteor.http.get('https://www.googleapis.com/freebase/v1/topic'+topic);
				Cache.Freebase.insert({topic_id: topic, cacheData: topicInfo});
				return topicInfo;
			}
		},
		checkForRecording: function(topic){
			var checkTopic = Meteor.http.get('https://www.googleapis.com/freebase/v1/search?query='+topic+'&filter=(all%20type:/music/recording)').data;
			if ( checkTopic.result.length > 0 ) {
				return true;
			} else {
				return false;
			}
		}
	}
}
