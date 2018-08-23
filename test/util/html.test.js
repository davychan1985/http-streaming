import document from 'global/document';
import window from 'global/window';
import QUnit from 'qunit';
import sinon from 'sinon';
import videojs from 'video.js';

QUnit.module('videojs-contrib-media-sources - HTML', {
  beforeEach() {
    this.fixture = document.getElementById('qunit-fixture');
    this.video = document.createElement('video');
    this.fixture.appendChild(this.video);
    this.source = document.createElement('source');

    this.player = videojs(this.video);
    // add a fake source so that we can get this.player_ on sourceopen
    this.url = 'fake.ts';
    this.source.src = this.url;
    this.video.appendChild(this.source);

    // Mock the environment's timers because certain things - particularly
    // player readiness - are asynchronous in video.js 5.
    this.clock = sinon.useFakeTimers();
    this.oldMediaSource = window.MediaSource || window.WebKitMediaSource;
    window.MediaSource = videojs.extend(videojs.EventTarget, {
      constructor() {
        this.isNative = true;
        this.sourceBuffers = [];
        this.duration = NaN;
      },
      addSourceBuffer(type) {
        let buffer = new (videojs.extend(videojs.EventTarget, {
          type,
          appendBuffer() {}
        }))();

        this.sourceBuffers.push(buffer);
        return buffer;
      }
    });
    window.MediaSource.isTypeSupported = function(mime) {
      return true;
    };
    window.WebKitMediaSource = window.MediaSource;
  },
  afterEach() {
    this.clock.restore();
    this.player.dispose();
    window.MediaSource = this.oldMediaSource;
    window.WebKitMediaSource = window.MediaSource;
  }
});

const createDataMessage = function(type, typedArray, extraObject) {
  let message = {
    data: {
      action: 'data',
      segment: {
        type,
        data: typedArray.buffer,
        initSegment: {
          data: typedArray.buffer,
          byteOffset: typedArray.byteOffset,
          byteLength: typedArray.byteLength
        }
      },
      byteOffset: typedArray.byteOffset,
      byteLength: typedArray.byteLength
    }
  };

  return Object.keys(extraObject || {}).reduce(function(obj, key) {
    obj.data.segment[key] = extraObject[key];
    return obj;
  }, message);
};

// Create a WebWorker-style message that signals the transmuxer is done
const doneMessage = {
  data: {
    action: 'done'
  }
};

// send fake data to the transmuxer to trigger the creation of the
// native source buffers
const initializeNativeSourceBuffers = function(sourceBuffer) {
  // initialize an audio source buffer
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', new Uint8Array(1)));

  // initialize a video source buffer
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1)));

  // instruct the transmuxer to flush the "data" it has buffered so
  // far
  sourceBuffer.transmuxer_.onmessage(doneMessage);
};

QUnit.todo('creates mp4 source buffers for mp2t segments', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the default codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'audio buffer has the default codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
  assert.ok(sourceBuffer.transmuxer_, 'created a transmuxer');
});

QUnit.todo(
'the terminate is called on the transmuxer when the media source is killed',
function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let terminates = 0;

  sourceBuffer.transmuxer_ = {
    terminate() {
      terminates++;
    }
  };

  mediaSource.trigger('sourceclose');

  assert.strictEqual(terminates, 1, 'called terminate on transmux web worker');
});

// TODO: should be able to delete this
QUnit.test('duration is faked when playing a live stream', function(assert) {
  let mediaSource = new videojs.MediaSource();

  mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = Infinity;
  mediaSource.nativeMediaSource_.duration = 100;
  assert.strictEqual(mediaSource.nativeMediaSource_.duration, 100,
              'native duration was not set to infinity');
  assert.strictEqual(mediaSource.duration, Infinity,
              'the MediaSource wrapper pretends it has an infinite duration');
});

// TODO: should be able to delete this
QUnit.test(
'duration uses the underlying MediaSource\'s duration when not live', function(assert) {
  let mediaSource = new videojs.MediaSource();

  mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = 100;
  mediaSource.nativeMediaSource_.duration = 120;
  assert.strictEqual(mediaSource.duration, 120,
              'the MediaSource wrapper returns the native duration');
});

// TODO: Needs a rewrite for native MediaSource world
QUnit.todo(
'calling remove deletes cues and invokes remove on any extant source buffers',
function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let removedCue = [];
  let removes = 0;

  initializeNativeSourceBuffers(sourceBuffer);

  sourceBuffer.inbandTextTracks_ = {
    CC1: {
      removeCue(cue) {
        removedCue.push(cue);
        this.cues.splice(this.cues.indexOf(cue), 1);
      },
      cues: [
        {startTime: 10, endTime: 20, text: 'delete me'},
        {startTime: 0, endTime: 2, text: 'save me'}
      ]
    }
  };
  mediaSource.videoBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };
  mediaSource.audioBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };

  sourceBuffer.remove(3, 10);

  assert.strictEqual(removes, 2, 'called remove on both sourceBuffers');
  assert.strictEqual(
    sourceBuffer.inbandTextTracks_.CC1.cues.length,
    1,
    'one cue remains after remove'
  );
  assert.strictEqual(
    removedCue[0].text,
    'delete me',
    'the cue that overlapped the remove region was removed'
  );
});

// TODO: Needs a rewrite for native MediaSource world
QUnit.todo(
'calling remove property handles absence of cues (null)',
function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  sourceBuffer.inbandTextTracks_ = {
    CC1: {
      cues: null
    }
  };

  mediaSource.videoBuffer_.remove = function(start, end) {
    // pass
  };
  mediaSource.audioBuffer_.remove = function(start, end) {
    // pass
  };

  // this call should not raise an exception
  sourceBuffer.remove(3, 10);

  assert.strictEqual(
    sourceBuffer.inbandTextTracks_.CC1.cues,
    null,
    'cues are still null'
  );
});

// TODO: Needs a rewrite for native MediaSource world
QUnit.test('removing doesn\'t happen with audio disabled', function(assert) {
  let mediaSource = new window.MediaSource();
  let muxedBuffer = mediaSource.addSourceBuffer('video/mp2t');

  // creating this audio buffer disables audio in the muxed one
  mediaSource.addSourceBuffer('audio/mp2t; codecs="mp4a.40.2"');

  let removedCue = [];
  let removes = 0;

  initializeNativeSourceBuffers(muxedBuffer);

  muxedBuffer.inbandTextTracks_ = {
    CC1: {
      removeCue(cue) {
        removedCue.push(cue);
        this.cues.splice(this.cues.indexOf(cue), 1);
      },
      cues: [
        {startTime: 10, endTime: 20, text: 'delete me'},
        {startTime: 0, endTime: 2, text: 'save me'}
      ]
    }
  };
  mediaSource.videoBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };
  mediaSource.audioBuffer_.remove = function(start, end) {
    if (start === 3 && end === 10) {
      removes++;
    }
  };

  muxedBuffer.remove(3, 10);

  assert.strictEqual(removes, 1, 'called remove on only one source buffer');
  assert.strictEqual(muxedBuffer.inbandTextTracks_.CC1.cues.length,
              1,
              'one cue remains after remove');
  assert.strictEqual(removedCue[0].text,
              'delete me',
              'the cue that overlapped the remove region was removed');
});

// TODO We should test addSeekableRange in master playlist controller instead
QUnit.todo('addSeekableRange_ throws an error for media with known duration',
function(assert) {
  let mediaSource = new window.MediaSource();

  mediaSource.duration = 100;
  assert.throws(function() {
    mediaSource.addSeekableRange_(0, 100);
  }, 'cannot add seekable range');
});

// TODO We should test addSeekableRange in master playlist controller instead
QUnit.todo('addSeekableRange_ adds to the native MediaSource duration', function(assert) {
  let mediaSource = new videojs.MediaSource();

  mediaSource.duration = Infinity;
  mediaSource.addSeekableRange_(120, 240);
  assert.strictEqual(mediaSource.nativeMediaSource_.duration, 240, 'set native duration');
  assert.strictEqual(mediaSource.duration, Infinity, 'emulated duration');

  mediaSource.addSeekableRange_(120, 220);
  assert.strictEqual(mediaSource.nativeMediaSource_.duration,
                     240,
                     'ignored the smaller range');
  assert.strictEqual(mediaSource.duration, Infinity, 'emulated duration');
});

// TODO Rewrite this test for native MediaSource
QUnit.todo('appendBuffer error triggers on the player', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let error = false;

  mediaSource.player_ = this.player;

  initializeNativeSourceBuffers(sourceBuffer);

  sourceBuffer.videoBuffer_.appendBuffer = () => {
    throw new Error();
  };

  this.player.on('error', () => {
    error = true;
  });

  // send fake data to the source buffer from the transmuxer to append to native buffer
  // initializeNativeSourceBuffers does the same thing to trigger the creation of
  // native source buffers.
  let fakeTransmuxerMessage = initializeNativeSourceBuffers;

  fakeTransmuxerMessage(sourceBuffer);

  this.clock.tick(1);

  assert.ok(error, 'error triggered on player');
});

// TODO: can this be rewritten for native MediaSources?
QUnit.test('transmuxes mp2t segments', function(assert) {
  let mp2tSegments = [];
  let mp4Segments = [];
  let data = new Uint8Array(1);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  sourceBuffer.transmuxer_.postMessage = function(segment) {
    if (segment.action === 'push') {
      let buffer = new Uint8Array(segment.data, segment.byteOffset, segment.byteLength);

      mp2tSegments.push(buffer);
    }
  };

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    mp4Segments.push(segmentObj);
  };

  sourceBuffer.appendBuffer(data);
  assert.strictEqual(mp2tSegments.length, 1, 'transmuxed one segment');
  assert.strictEqual(mp2tSegments[0].length, 1, 'did not alter the segment');
  assert.strictEqual(mp2tSegments[0][0], data[0], 'did not alter the segment');

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1)));

  // a media segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', new Uint8Array(1)));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 2, 'appended the segments');
});

// TODO rewrite for native world
QUnit.todo(
'handles typed-arrays that are subsets of their underlying buffer',
function(assert) {
  let mp2tSegments = [];
  let mp4Segments = [];
  let dataBuffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let data = dataBuffer.subarray(5, 7);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  sourceBuffer.transmuxer_.postMessage = function(segment) {
    if (segment.action === 'push') {
      let buffer = new Uint8Array(segment.data, segment.byteOffset, segment.byteLength);

      mp2tSegments.push(buffer);
    }
  };

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    mp4Segments.push(segmentObj.segments[0]);
  };

  sourceBuffer.appendBuffer(data);

  assert.strictEqual(mp2tSegments.length, 1, 'emitted the fragment');
  assert.strictEqual(
    mp2tSegments[0].length,
    2,
    'correctly handled a typed-array that is a subset'
  );
  assert.strictEqual(mp2tSegments[0][0], 5, 'fragment contains the correct first byte');
  assert.strictEqual(mp2tSegments[0][1], 6, 'fragment contains the correct second byte');

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 1, 'emitted the fragment');
  assert.strictEqual(
    mp4Segments[0].length,
    2,
    'correctly handled a typed-array that is a subset'
  );
  assert.strictEqual(mp4Segments[0][0], 5, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[0][1], 6, 'fragment contains the correct second byte');
});

// TODO Rewrite with native MediaSource
QUnit.todo(
'only appends audio init segment for first segment or on audio/media changes',
function(assert) {
  let mp4Segments = [];
  let initBuffer = new Uint8Array([0, 1]);
  let dataBuffer = new Uint8Array([2, 3]);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  sourceBuffer.audioDisabled_ = false;
  mediaSource.player_ = this.player;
  mediaSource.url_ = this.url;
  mediaSource.trigger('sourceopen');

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    let segment = segmentObj.segments.reduce((seg, arr) => seg.concat(Array.from(arr)),
      []);

    mp4Segments.push(segment);
  };

  assert.ok(sourceBuffer.appendAudioInitSegment_, 'will append init segment next');

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 1, 'emitted the fragment');
  // Contains init segment on first segment
  assert.strictEqual(mp4Segments[0][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[0][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[0][2], 2, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[0][3], 3, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  dataBuffer = new Uint8Array([4, 5]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 2, 'emitted the fragment');
  // does not contain init segment on next segment
  assert.strictEqual(mp4Segments[1][0], 4, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[1][1], 5, 'fragment contains the correct second byte');

  // audio track change
  this.player.audioTracks().trigger('change');
  sourceBuffer.audioDisabled_ = false;
  assert.ok(sourceBuffer.appendAudioInitSegment_,
            'audio change sets appendAudioInitSegment_');
  dataBuffer = new Uint8Array([6, 7]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 3, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[2][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[2][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[2][2], 6, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[2][3], 7, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  dataBuffer = new Uint8Array([8, 9]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 4, 'emitted the fragment');
  // does not contain init segment in next segment
  assert.strictEqual(mp4Segments[3][0], 8, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[3][1], 9, 'fragment contains the correct second byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');

  // rendition switch
  this.player.trigger('mediachange');
  assert.ok(sourceBuffer.appendAudioInitSegment_,
            'media change sets appendAudioInitSegment_');
  dataBuffer = new Uint8Array([10, 11]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 5, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[4][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[4][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[4][2], 10, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[4][3], 11, 'fragment contains the correct fourth byte');
  assert.ok(!sourceBuffer.appendAudioInitSegment_, 'will not append init segment next');
});

// TODO Rewrite with native MediaSource
QUnit.todo(
'appends video init segment for every segment',
function(assert) {
  let mp4Segments = [];
  let initBuffer = new Uint8Array([0, 1]);
  let dataBuffer = new Uint8Array([2, 3]);
  let mediaSource;
  let sourceBuffer;

  mediaSource = new window.MediaSource();
  sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  mediaSource.player_ = this.player;
  mediaSource.url_ = this.url;
  mediaSource.trigger('sourceopen');

  sourceBuffer.concatAndAppendSegments_ = function(segmentObj, destinationBuffer) {
    let segment = segmentObj.segments.reduce((seg, arr) => seg.concat(Array.from(arr)),
      []);

    mp4Segments.push(segment);
  };

  // an init segment
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));

  // Segments are concatenated
  assert.strictEqual(
    mp4Segments.length,
    0,
    'segments are not appended until after the `done` message'
  );

  // send `done` message
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  // Segments are concatenated
  assert.strictEqual(mp4Segments.length, 1, 'emitted the fragment');
  // Contains init segment on first segment
  assert.strictEqual(mp4Segments[0][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[0][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[0][2], 2, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[0][3], 3, 'fragment contains the correct fourth byte');

  dataBuffer = new Uint8Array([4, 5]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 2, 'emitted the fragment');
  assert.strictEqual(mp4Segments[1][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[1][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[1][2], 4, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[1][3], 5, 'fragment contains the correct fourth byte');

  dataBuffer = new Uint8Array([6, 7]);
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', dataBuffer, {
    initSegment: {
      data: initBuffer.buffer,
      byteOffset: initBuffer.byteOffset,
      byteLength: initBuffer.byteLength
    }
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  assert.strictEqual(mp4Segments.length, 3, 'emitted the fragment');
  // contains init segment after audio track change
  assert.strictEqual(mp4Segments[2][0], 0, 'fragment contains the correct first byte');
  assert.strictEqual(mp4Segments[2][1], 1, 'fragment contains the correct second byte');
  assert.strictEqual(mp4Segments[2][2], 6, 'fragment contains the correct third byte');
  assert.strictEqual(mp4Segments[2][3], 7, 'fragment contains the correct fourth byte');
});

// TODO: maybe rewrite for native world?
QUnit.todo('handles empty codec string value', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs=""');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the default codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'audio buffer has the default codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

// TODO: maybe rewrite for native world?
QUnit.todo('can create an audio buffer by itself', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="mp4a.40.2"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(!mediaSource.videoBuffer_, 'did not create a video buffer');
  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'audio buffer has the default codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

// TODO: maybe rewrite for native world?
QUnit.todo('can create an video buffer by itself', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.4d400d"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(!mediaSource.audioBuffer_, 'did not create an audio buffer');
  assert.ok(mediaSource.videoBuffer_, 'created an video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the codec that was passed'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

// TODO: maybe rewrite for native world?
QUnit.todo('handles invalid codec string', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="nope"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.4d400d"',
    'video buffer has the default codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.2"',
    'audio buffer has the default codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
});

// TODO: maybe rewrite for native world?
QUnit.todo('handles codec strings in reverse order', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="mp4a.40.5,avc1.64001f"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');

  assert.strictEqual(
    mediaSource.videoBuffer_.type,
    'video/mp4;codecs="avc1.64001f"',
    'video buffer has the passed codec'
  );

  assert.ok(mediaSource.audioBuffer_, 'created an audio buffer');
  assert.strictEqual(
    mediaSource.audioBuffer_.type,
    'audio/mp4;codecs="mp4a.40.5"',
    'audio buffer has the passed codec'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 1, 'created one virtual buffer');
  assert.strictEqual(
    mediaSource.sourceBuffers[0],
    sourceBuffer,
    'returned the virtual buffer'
  );
  assert.ok(sourceBuffer.transmuxer_, 'created a transmuxer');
});

// TODO: maybe rewrite for native world?
QUnit.todo('parses old-school apple codec strings to the modern standard',
function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer =
    mediaSource.addSourceBuffer('video/mp2t; codecs="avc1.100.31,mp4a.40.5"');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.videoBuffer_.type,
              'video/mp4;codecs="avc1.64001f"',
              'passed the video codec along');

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.audioBuffer_.type,
              'audio/mp4;codecs="mp4a.40.5"',
              'passed the audio codec along');

});

// TODO: maybe rewrite for native world?
QUnit.todo('specifies reasonable codecs if none are specified', function(assert) {
  let mediaSource = new videojs.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  assert.ok(mediaSource.videoBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.videoBuffer_.type,
              'video/mp4;codecs="avc1.4d400d"',
              'passed the video codec along');

  assert.ok(mediaSource.audioBuffer_, 'created a video buffer');
  assert.strictEqual(mediaSource.audioBuffer_.type,
              'audio/mp4;codecs="mp4a.40.2"',
              'passed the audio codec along');
});

// TODO: should be able to remove
QUnit.todo('virtual buffers are updating if either native buffer is', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  initializeNativeSourceBuffers(sourceBuffer);

  mediaSource.videoBuffer_.updating = true;
  mediaSource.audioBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.audioBuffer_.updating = true;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.videoBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, true, 'virtual buffer is updating');

  mediaSource.audioBuffer_.updating = false;
  assert.strictEqual(sourceBuffer.updating, false, 'virtual buffer is not updating');
});

// TODO: maybe rewrite for native world?
QUnit.todo('disabled audio does not affect buffered property', function(assert) {
  let mediaSource = new window.MediaSource();
  let muxedBuffer = mediaSource.addSourceBuffer('video/mp2t');
  // creating a separate audio buffer disables audio on the muxed one
  let audioBuffer = mediaSource.addSourceBuffer('audio/mp2t; codecs="mp4a.40.2"');

  initializeNativeSourceBuffers(muxedBuffer);

  mediaSource.videoBuffer_.buffered = videojs.createTimeRanges([[1, 10]]);
  mediaSource.audioBuffer_.buffered = videojs.createTimeRanges([[2, 11]]);

  assert.strictEqual(audioBuffer.buffered.length, 1, 'one buffered range');
  assert.strictEqual(audioBuffer.buffered.start(0), 2, 'starts at two');
  assert.strictEqual(audioBuffer.buffered.end(0), 11, 'ends at eleven');
  assert.strictEqual(muxedBuffer.buffered.length, 1, 'one buffered range');
  assert.strictEqual(muxedBuffer.buffered.start(0), 1, 'starts at one');
  assert.strictEqual(muxedBuffer.buffered.end(0), 10, 'ends at ten');
});

// TODO: maybe rewrite for native world?
QUnit.todo('sets transmuxer baseMediaDecodeTime on appends', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let resets = [];

  sourceBuffer.transmuxer_.postMessage = function(message) {
    if (message.action === 'setTimestampOffset') {
      resets.push(message.timestampOffset);
    }
  };

  sourceBuffer.timestampOffset = 42;

  assert.strictEqual(
    resets.length,
    1,
    'reset called'
  );
  assert.strictEqual(
    resets[0],
    42,
    'set the baseMediaDecodeTime based on timestampOffset'
  );
});

// TODO: maybe rewrite for native world?
QUnit.todo('aggregates source buffer update events', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let updates = 0;
  let updateends = 0;
  let updatestarts = 0;

  initializeNativeSourceBuffers(sourceBuffer);

  mediaSource.player_ = this.player;

  sourceBuffer.addEventListener('updatestart', function() {
    updatestarts++;
  });
  sourceBuffer.addEventListener('update', function() {
    updates++;
  });
  sourceBuffer.addEventListener('updateend', function() {
    updateends++;
  });

  assert.strictEqual(updatestarts,
                     0,
                     'no updatestarts before a `done` message is received');
  assert.strictEqual(updates, 0, 'no updates before a `done` message is received');
  assert.strictEqual(updateends, 0, 'no updateends before a `done` message is received');

  // the video buffer begins updating first:
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('updatestart');
  assert.strictEqual(updatestarts, 1, 'aggregated updatestart');
  sourceBuffer.audioBuffer_.updating = true;
  sourceBuffer.audioBuffer_.trigger('updatestart');
  assert.strictEqual(updatestarts, 1, 'aggregated updatestart');

  // the audio buffer finishes first:
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.trigger('update');
  assert.strictEqual(updates, 0, 'waited for the second update');
  sourceBuffer.videoBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('update');
  assert.strictEqual(updates, 1, 'aggregated update');

  // audio finishes first:
  sourceBuffer.videoBuffer_.updating = true;
  sourceBuffer.audioBuffer_.updating = false;
  sourceBuffer.audioBuffer_.trigger('updateend');
  assert.strictEqual(updateends, 0, 'waited for the second updateend');
  sourceBuffer.videoBuffer_.updating = false;
  sourceBuffer.videoBuffer_.trigger('updateend');
  assert.strictEqual(updateends, 1, 'aggregated updateend');
});

// TODO most likely belongs somewhere else?
QUnit.todo('translates caption events into WebVTT cues', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let types = [];
  let hls608 = 0;

  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      types.push(options.kind);
      return {
        track: {
          kind: options.kind,
          label: options.label,
          cues: [],
          addCue(cue) {
            this.cues.push(cue);
          }
        }
      };
    },
    textTracks() {
      return {
        getTrackById() {}
      };
    },
    remoteTextTracks() {
    },
    tech_: new videojs.EventTarget()
  };
  mediaSource.player_.tech_.on('usage', (event) => {
    if (event.name === 'hls-608') {
      hls608++;
    }
  });
  sourceBuffer.timestampOffset = 10;
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    captions: [{
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC1',
      stream: 'CC1'
    }],
    captionStreams: {CC1: true}
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);
  let cues = sourceBuffer.inbandTextTracks_.CC1.cues;

  assert.strictEqual(hls608, 1, 'one hls-608 event was triggered');
  assert.strictEqual(types.length, 1, 'created one text track');
  assert.strictEqual(types[0], 'captions', 'the type was captions');
  assert.strictEqual(cues.length, 1, 'created one cue');
  assert.strictEqual(cues[0].text,
                     'This is an in-band caption in CC1',
                     'included the text');
  assert.strictEqual(cues[0].startTime, 11, 'started at eleven');
  assert.strictEqual(cues[0].endTime, 13, 'ended at thirteen');
});

// TODO most likely belongs somewhere else?
QUnit.todo('captions use existing tracks with id equal to CC#', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let addTrackCalled = 0;
  let tracks = {
    CC1: {
      kind: 'captions',
      label: 'CC1',
      id: 'CC1',
      cues: [],
      addCue(cue) {
        this.cues.push(cue);
      }
    },
    CC2: {
      kind: 'captions',
      label: 'CC2',
      id: 'CC2',
      cues: [],
      addCue(cue) {
        this.cues.push(cue);
      }
    }
  };

  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      addTrackCalled++;
    },
    textTracks() {
      return {
        getTrackById(id) {
          return tracks[id];
        }
      };
    },
    remoteTextTracks() {
    },
    tech_: new videojs.EventTarget()
  };
  sourceBuffer.timestampOffset = 10;
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    captions: [{
      stream: 'CC1',
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC1'
    }, {
      stream: 'CC2',
      startTime: 1,
      endTime: 3,
      text: 'This is an in-band caption in CC2'
    }],
    captionStreams: {CC1: true, CC2: true}
  }));

  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(addTrackCalled, 0, 'no tracks were created');
  assert.strictEqual(tracks.CC1.cues.length, 1, 'CC1 contains 1 cue');
  assert.strictEqual(tracks.CC2.cues.length, 1, 'CC2 contains 1 cue');

  assert.strictEqual(tracks.CC1.cues[0].text,
                     'This is an in-band caption in CC1',
                     'CC1 contains the right cue');
  assert.strictEqual(tracks.CC2.cues[0].text,
                     'This is an in-band caption in CC2',
                     'CC2 contains the right cue');
});

// TODO most likely belongs somewhere else?
QUnit.todo('translates metadata events into WebVTT cues', function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');

  mediaSource.duration = Infinity;
  mediaSource.nativeMediaSource_.duration = 60;

  let types = [];
  let metadata = [{
    cueTime: 2,
    frames: [{
      url: 'This is a url tag'
    }, {
      value: 'This is a text tag'
    }]
  }, {
    cueTime: 12,
    frames: [{
      data: 'This is a priv tag'
    }]
  }];

  metadata.dispatchType = 0x10;
  mediaSource.player_ = {
    addRemoteTextTrack(options) {
      types.push(options.kind);
      return {
        track: {
          kind: options.kind,
          label: options.label,
          cues: [],
          addCue(cue) {
            this.cues.push(cue);
          }
        }
      };
    },
    remoteTextTracks() {
    }
  };
  sourceBuffer.timestampOffset = 10;

  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', new Uint8Array(1), {
    metadata
  }));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(
    sourceBuffer.metadataTrack_.inBandMetadataTrackDispatchType,
    16,
  'in-band metadata track dispatch type correctly set'
  );
  let cues = sourceBuffer.metadataTrack_.cues;

  assert.strictEqual(types.length, 1, 'created one text track');
  assert.strictEqual(types[0], 'metadata', 'the type was metadata');
  assert.strictEqual(cues.length, 3, 'created three cues');
  assert.strictEqual(cues[0].text, 'This is a url tag', 'included the text');
  assert.strictEqual(cues[0].startTime, 12, 'started at twelve');
  assert.strictEqual(cues[0].endTime, 22, 'ended at StartTime of next cue(22)');
  assert.strictEqual(cues[1].text, 'This is a text tag', 'included the text');
  assert.strictEqual(cues[1].startTime, 12, 'started at twelve');
  assert.strictEqual(cues[1].endTime, 22, 'ended at the startTime of next cue(22)');
  assert.strictEqual(cues[2].text, 'This is a priv tag', 'included the text');
  assert.strictEqual(cues[2].startTime, 22, 'started at twenty two');
  assert.strictEqual(cues[2].endTime, Number.MAX_VALUE, 'ended at the maximum value');
  mediaSource.duration = 100;
  mediaSource.trigger('sourceended');
  assert.strictEqual(cues[2].endTime, mediaSource.duration, 'sourceended is fired');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('does not wrap mp4 source buffers', function(assert) {
  let mediaSource = new window.MediaSource();

  mediaSource.addSourceBuffer('video/mp4;codecs=avc1.4d400d');
  mediaSource.addSourceBuffer('audio/mp4;codecs=mp4a.40.2');
  assert.strictEqual(
    mediaSource.sourceBuffers.length,
    mediaSource.nativeMediaSource_.sourceBuffers.length,
    'did not need virtual buffers'
  );
  assert.strictEqual(mediaSource.sourceBuffers.length, 2, 'created native buffers');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('can get activeSourceBuffers', function(assert) {
  let mediaSource = new window.MediaSource();

  // although activeSourceBuffers should technically be a SourceBufferList, we are
  // returning it as an array, and users may expect it to behave as such
  assert.ok(Array.isArray(mediaSource.activeSourceBuffers));
});

// TODO: rewrite for native MediaSource world
QUnit.todo('active source buffers are updated on each buffer\'s updateend',
function(assert) {
  let mediaSource = new window.MediaSource();
  let updateCallCount = 0;

  mediaSource.updateActiveSourceBuffers_ = () => {
    updateCallCount++;
  };

  mediaSource.addSourceBuffer('video/mp2t');
  mediaSource.player_ = this.player;
  mediaSource.url_ = this.url;
  mediaSource.trigger('sourceopen');
  assert.strictEqual(updateCallCount, 0,
              'active source buffers not updated on adding source buffer');

  mediaSource.player_.audioTracks().trigger('addtrack');
  assert.strictEqual(updateCallCount, 1,
              'active source buffers updated after addtrack');

  mediaSource.addSourceBuffer('video/mp2t');
  assert.strictEqual(updateCallCount, 1,
              'active source buffers not updated on adding second source buffer');

  mediaSource.player_.audioTracks().trigger('removetrack');
  assert.strictEqual(updateCallCount, 2,
              'active source buffers updated after removetrack');

  mediaSource.player_.audioTracks().trigger('change');
  assert.strictEqual(updateCallCount, 3,
              'active source buffers updated after change');

});

// TODO: rewrite for native MediaSource world
QUnit.todo('combined buffer is the only active buffer when main track enabled',
function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBufferAudio;
  let sourceBufferCombined;
  let audioTracks = [{
    enabled: true,
    kind: 'main',
    label: 'main'
  }, {
    enabled: false,
    kind: 'alternative',
    label: 'English (UK)'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferCombined.videoCodec_ = true;
  sourceBufferCombined.audioCodec_ = true;
  sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 1,
    'active source buffers starts with one source buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'active source buffers starts with combined source buffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('combined & audio buffers are active when alternative track enabled',
function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBufferAudio;
  let sourceBufferCombined;
  let audioTracks = [{
    enabled: false,
    kind: 'main',
    label: 'main'
  }, {
    enabled: true,
    kind: 'alternative',
    label: 'English (UK)'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferCombined.videoCodec_ = true;
  sourceBufferCombined.audioCodec_ = true;
  sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 2,
    'active source buffers includes both source buffers');
  // maintains same order as source buffers were created
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'active source buffers starts with combined source buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[1], sourceBufferAudio,
    'active source buffers ends with audio source buffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('main buffer is the only active buffer when combined is audio only and' +
'main track enabled', function(assert) {
  const mediaSource = new window.MediaSource();
  const audioTracks = [{
    enabled: true,
    kind: 'main',
    label: 'main'
  }, {
    enabled: false,
    kind: 'alternative',
    label: 'English'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  const sourceBufferCombined = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferCombined.videoCodec_ = false;
  sourceBufferCombined.audioCodec_ = true;

  const sourceBufferAudio = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 1,
    'active source buffers has only one buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'main buffer is the only active source buffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('audio buffer is the only active buffer when combined is audio only and' +
'alternative track enabled', function(assert) {
  const mediaSource = new window.MediaSource();
  const audioTracks = [{
    enabled: false,
    kind: 'main',
    label: 'main'
  }, {
    enabled: true,
    kind: 'alternative',
    label: 'English'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  const sourceBufferCombined = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferCombined.videoCodec_ = false;
  sourceBufferCombined.audioCodec_ = true;

  const sourceBufferAudio = mediaSource.addSourceBuffer('audio/m2pt');

  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 1,
    'active source buffers has only one buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferAudio,
    'audio buffer is the only active source buffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('video only & audio only buffers are always active',
function(assert) {
  let mediaSource = new window.MediaSource();
  let sourceBufferAudio;
  let sourceBufferCombined;
  let audioTracks = [{
    enabled: false,
    kind: 'main',
    label: 'main'
  }, {
    enabled: true,
    kind: 'alternative',
    label: 'English (UK)'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  sourceBufferCombined = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferCombined.videoCodec_ = true;
  sourceBufferCombined.audioCodec_ = false;
  sourceBufferAudio = mediaSource.addSourceBuffer('video/m2pt');
  sourceBufferAudio.videoCodec_ = false;
  sourceBufferAudio.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 2,
    'active source buffers includes both source buffers');
  // maintains same order as source buffers were created
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'active source buffers starts with combined source buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[1], sourceBufferAudio,
    'active source buffers ends with audio source buffer');

  audioTracks[0].enabled = true;
  audioTracks[1].enabled = false;
  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 2,
    'active source buffers includes both source buffers');
  // maintains same order as source buffers were created
  assert.strictEqual(mediaSource.activeSourceBuffers[0], sourceBufferCombined,
    'active source buffers starts with combined source buffer');
  assert.strictEqual(mediaSource.activeSourceBuffers[1], sourceBufferAudio,
    'active source buffers ends with audio source buffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('Single buffer always active. Audio disabled depends on audio codec',
function(assert) {
  let mediaSource = new window.MediaSource();
  let audioTracks = [{
    enabled: true,
    kind: 'main',
    label: 'main'
  }];

  this.player.audioTracks = () => audioTracks;

  mediaSource.player_ = this.player;

  let sourceBuffer = mediaSource.addSourceBuffer('video/m2pt');

  // video only
  sourceBuffer.videoCodec_ = true;
  sourceBuffer.audioCodec_ = false;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 1, 'sourceBuffer is active');
  assert.ok(mediaSource.activeSourceBuffers[0].audioDisabled_,
    'audio is disabled on video only active sourceBuffer');

  // audio only
  sourceBuffer.videoCodec_ = false;
  sourceBuffer.audioCodec_ = true;

  mediaSource.updateActiveSourceBuffers_();

  assert.strictEqual(mediaSource.activeSourceBuffers.length, 1, 'sourceBuffer is active');
  assert.notOk(mediaSource.activeSourceBuffers[0].audioDisabled_,
    'audio not disabled on audio only active sourceBuffer');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('video segments with info trigger videooinfo event', function(assert) {
  let data = new Uint8Array(1);
  let infoEvents = [];
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let info = {width: 100};
  let newinfo = {width: 225};

  mediaSource.on('videoinfo', (e) => infoEvents.push(e));

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data, {info}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 1, 'video info should trigger');
  assert.deepEqual(infoEvents[0].info, info, 'video info = muxed info');

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('video', data, {info: newinfo}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 2, 'video info should trigger');
  assert.deepEqual(infoEvents[1].info, newinfo, 'video info = muxed info');
});

// TODO: rewrite for native MediaSource world
QUnit.todo('audio segments with info trigger audioinfo event', function(assert) {
  let data = new Uint8Array(1);
  let infoEvents = [];
  let mediaSource = new window.MediaSource();
  let sourceBuffer = mediaSource.addSourceBuffer('video/mp2t');
  let info = {width: 100};
  let newinfo = {width: 225};

  mediaSource.on('audioinfo', (e) => infoEvents.push(e));

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', data, {info}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 1, 'audio info should trigger');
  assert.deepEqual(infoEvents[0].info, info, 'audio info = muxed info');

  // send an audio segment with info, then send done
  sourceBuffer.transmuxer_.onmessage(createDataMessage('audio', data, {info: newinfo}));
  sourceBuffer.transmuxer_.onmessage(doneMessage);

  assert.strictEqual(infoEvents.length, 2, 'audio info should trigger');
  assert.deepEqual(infoEvents[1].info, newinfo, 'audio info = muxed info');
});
