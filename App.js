import { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Animated,
  KeyboardAvoidingView, Platform, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Calendar from 'expo-calendar';
import { StatusBar } from 'expo-status-bar';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
const { width } = Dimensions.get('window');

const C = {
  bg: '#090909',
  surface: '#111111',
  surface2: '#1a1a1a',
  border: '#222222',
  accent: '#c8f060',
  accentDim: 'rgba(200,240,96,0.12)',
  text: '#f5f2ed',
  textSub: '#999999',
  textMuted: '#444444',
  focus: '#4a5aff',
  focusBg: 'rgba(74,90,255,0.15)',
  work: '#1e2340',
  workText: '#7a8fff',
  break: '#0f2a1a',
  breakText: '#4dbd7a',
  admin: '#2a1e0a',
  adminText: '#d4943a',
};

const TAG_COLORS = {
  focus:  { bg: C.focusBg, text: '#7a8fff' },
  work:   { bg: C.work,    text: C.workText },
  break:  { bg: C.break,   text: C.breakText },
  admin:  { bg: C.admin,   text: C.adminText },
};

function EventCard({ item, index }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(18)).current;

  useState(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, delay: index * 60, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 320, delay: index * 60, useNativeDriver: true }),
    ]).start();
  });

  const tag = TAG_COLORS[item.category] || TAG_COLORS.work;

  return (
    <Animated.View style={[styles.eventCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.eventLeft}>
        <View style={[styles.eventDot, { backgroundColor: tag.text }]} />
        <View style={styles.eventLine} />
      </View>
      <View style={styles.eventRight}>
        <Text style={styles.eventTime}>{item.time}</Text>
        <Text style={styles.eventTitle}>{item.title}</Text>
        {item.note ? <Text style={styles.eventNote}>{item.note}</Text> : null}
        <View style={[styles.tag, { backgroundColor: tag.bg }]}>
          <Text style={[styles.tagText, { color: tag.text }]}>{item.category}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function App() {
  const [tasks, setTasks] = useState('');
  const [startTime, setStartTime] = useState('9:00 AM');
  const [endTime, setEndTime] = useState('6:00 PM');
  const [prefs, setPrefs] = useState('');
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [step, setStep] = useState('input'); // input | result
  const scrollRef = useRef(null);

  const btnScale = useRef(new Animated.Value(1)).current;

  const pressIn = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start();

  const generate = async () => {
    if (!tasks.trim()) { Alert.alert('Add some tasks first'); return; }
    setLoading(true);
    setSchedule([]);
    setAdded(false);
    setStep('input');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1200,
          system: `You are a productivity scheduling assistant. Given tasks and preferences, produce a realistic time-blocked daily schedule.

Return ONLY a JSON array, no markdown, no preamble. Each item:
- "time": "9:00 AM – 10:00 AM"
- "title": short task name
- "note": one-sentence tip (can be empty string)
- "category": one of "focus", "work", "break", "admin"
- "start_24": start time in HHmm format e.g. "0900"
- "end_24": end time in HHmm format e.g. "1000"

Rules: respect fixed times, schedule focus work early, add short breaks between long blocks, no overlaps, stay within start/end times.`,
          messages: [{
            role: 'user',
            content: `Day: ${startTime} to ${endTime}\nTasks:\n${tasks}${prefs ? '\nPreferences: ' + prefs : ''}`
          }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw = data.content.map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const result = JSON.parse(clean);
      setSchedule(result);
      setStep('result');
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 100);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const addToCalendar = async () => {
    setAdding(true);
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow calendar access in Settings.');
        setAdding(false);
        return;
      }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const cal = calendars.find(c => c.allowsModifications && c.source?.name === 'Default')
        || calendars.find(c => c.allowsModifications)
        || calendars[0];
      if (!cal) { Alert.alert('No calendar found'); setAdding(false); return; }

      const today = new Date();
      const ds = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      let count = 0;
      for (const item of schedule) {
        try {
          const s = (item.start_24||'0900').padStart(4,'0');
          const e = (item.end_24||'1000').padStart(4,'0');
          await Calendar.createEventAsync(cal.id, {
            title: item.title,
            notes: item.note || '',
            startDate: new Date(`${ds}T${s.slice(0,2)}:${s.slice(2,4)}:00`),
            endDate: new Date(`${ds}T${e.slice(0,2)}:${e.slice(2,4)}:00`),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          count++;
        } catch(err) { console.log(err); }
      }
      setAdded(true);
      Alert.alert('Locked in 🔒', `${count} events added to your Calendar.`);
    } catch(e) {
      Alert.alert('Error', e.message);
    } finally {
      setAdding(false);
    }
  };

  const reset = () => { setStep('input'); setSchedule([]); setAdded(false); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.logo}>locked<Text style={styles.logoAccent}>In</Text></Text>
              <View style={styles.pill}><Text style={styles.pillText}>AI SCHEDULER</Text></View>
            </View>
            {step === 'result' && (
              <TouchableOpacity onPress={reset} style={styles.resetBtn}>
                <Text style={styles.resetText}>New day</Text>
              </TouchableOpacity>
            )}
          </View>

          {step === 'input' && (
            <>
              {/* Time inputs */}
              <View style={styles.timeCard}>
                <View style={styles.timeCol}>
                  <Text style={styles.fieldLabel}>START</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={startTime}
                    onChangeText={setStartTime}
                    placeholderTextColor={C.textMuted}
                    selectTextOnFocus
                  />
                </View>
                <View style={styles.timeDivider} />
                <View style={styles.timeCol}>
                  <Text style={styles.fieldLabel}>END</Text>
                  <TextInput
                    style={styles.timeInput}
                    value={endTime}
                    onChangeText={setEndTime}
                    placeholderTextColor={C.textMuted}
                    selectTextOnFocus
                  />
                </View>
              </View>

              {/* Tasks */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>TASKS — dump it all</Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  multiline
                  value={tasks}
                  onChangeText={setTasks}
                  placeholder={'- Deep work (2 hrs)\n- Lunch\n- Client calls (1 hr)\n- Gym\n- Wind down'}
                  placeholderTextColor={C.textMuted}
                  textAlignVertical="top"
                />
              </View>

              {/* Prefs */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>PREFERENCES <Text style={styles.optional}>optional</Text></Text>
                <TextInput
                  style={styles.input}
                  value={prefs}
                  onChangeText={setPrefs}
                  placeholder="deep work in morning, breaks between blocks"
                  placeholderTextColor={C.textMuted}
                />
              </View>

              {/* Generate button */}
              <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                <TouchableOpacity
                  style={[styles.genBtn, loading && styles.genBtnLoading]}
                  onPress={generate}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={loading}
                  activeOpacity={1}
                >
                  {loading ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color={C.bg} size="small" />
                      <Text style={styles.genBtnText}>  Building your day...</Text>
                    </View>
                  ) : (
                    <Text style={styles.genBtnText}>Generate schedule →</Text>
                  )}
                </TouchableOpacity>
              </Animated.View>
            </>
          )}

          {step === 'result' && schedule.length > 0 && (
            <>
              {/* Summary bar */}
              <View style={styles.summaryBar}>
                <Text style={styles.summaryText}>{schedule.length} blocks</Text>
                <Text style={styles.summaryDot}>·</Text>
                <Text style={styles.summaryText}>{startTime} – {endTime}</Text>
                <Text style={styles.summaryDot}>·</Text>
                <Text style={styles.summaryText}>Today</Text>
              </View>

              {/* Events */}
              <View style={styles.timeline}>
                {schedule.map((item, i) => (
                  <EventCard key={i} item={item} index={i} />
                ))}
              </View>

              {/* Calendar button */}
              <TouchableOpacity
                style={[styles.calBtn, added && styles.calBtnDone]}
                onPress={addToCalendar}
                disabled={added || adding}
              >
                {adding ? (
                  <ActivityIndicator color={added ? C.breakText : C.bg} />
                ) : (
                  <Text style={[styles.calBtnText, added && styles.calBtnTextDone]}>
                    {added ? '✓  Locked into Calendar' : '＋  Add to iPhone Calendar'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={reset} style={styles.newDayLink}>
                <Text style={styles.newDayLinkText}>Plan a different day</Text>
              </TouchableOpacity>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 60, paddingTop: 8 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, marginTop: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { fontSize: 30, fontWeight: '800', color: C.text, letterSpacing: -1 },
  logoAccent: { color: C.accent },
  pill: { backgroundColor: C.accentDim, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(200,240,96,0.25)' },
  pillText: { fontSize: 9, fontWeight: '700', color: C.accent, letterSpacing: 1.2 },
  resetBtn: { backgroundColor: C.surface2, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: C.border },
  resetText: { fontSize: 13, color: C.textSub, fontWeight: '500' },

  // Time card
  timeCard: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: 'hidden' },
  timeCol: { flex: 1, padding: 14 },
  timeDivider: { width: 1, backgroundColor: C.border, marginVertical: 10 },
  timeInput: { fontSize: 20, fontWeight: '600', color: C.text, marginTop: 4 },

  // Fields
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1.6, marginBottom: 7 },
  optional: { fontWeight: '400', color: C.textMuted, letterSpacing: 0 },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    color: C.text,
    fontSize: 15,
    padding: 14,
    lineHeight: 22,
  },
  textarea: { height: 140, textAlignVertical: 'top' },

  // Generate button
  genBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    padding: 17,
    alignItems: 'center',
    marginTop: 6,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  genBtnLoading: { backgroundColor: 'rgba(200,240,96,0.7)' },
  genBtnText: { fontSize: 16, fontWeight: '700', color: C.bg, letterSpacing: 0.3 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  // Summary
  summaryBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  summaryText: { fontSize: 13, color: C.textSub, fontWeight: '500' },
  summaryDot: { fontSize: 13, color: C.textMuted },

  // Timeline
  timeline: { marginBottom: 24 },
  eventCard: { flexDirection: 'row', marginBottom: 2 },
  eventLeft: { width: 20, alignItems: 'center', paddingTop: 4 },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  eventLine: { flex: 1, width: 1, backgroundColor: C.border, marginBottom: -2 },
  eventRight: { flex: 1, paddingLeft: 14, paddingBottom: 20 },
  eventTime: { fontSize: 11, color: C.textMuted, fontWeight: '600', letterSpacing: 0.5, marginBottom: 3 },
  eventTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 4, letterSpacing: -0.2 },
  eventNote: { fontSize: 13, color: C.textSub, lineHeight: 18, marginBottom: 8 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },

  // Calendar button
  calBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    padding: 17,
    alignItems: 'center',
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  calBtnDone: { backgroundColor: C.break, borderWidth: 1, borderColor: C.breakText, shadowOpacity: 0 },
  calBtnText: { fontSize: 16, fontWeight: '700', color: C.bg, letterSpacing: 0.3 },
  calBtnTextDone: { color: C.breakText },

  newDayLink: { alignItems: 'center', marginTop: 20 },
  newDayLinkText: { fontSize: 14, color: C.textMuted, fontWeight: '500' },
});