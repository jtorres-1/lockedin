import { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Animated,
  KeyboardAvoidingView, Platform, Modal, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Calendar from 'expo-calendar';
import { StatusBar } from 'expo-status-bar';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
const RC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
const FREE_DAILY_LIMIT = 3;

const C = {
  bg: '#090909', surface: '#111111', surface2: '#1a1a1a', border: '#222222',
  accent: '#c8f060', accentDim: 'rgba(200,240,96,0.12)', text: '#f5f2ed',
  textSub: '#999999', textMuted: '#444444', focusBg: 'rgba(74,90,255,0.15)',
  work: '#1e2340', workText: '#7a8fff', break: '#0f2a1a', breakText: '#4dbd7a',
  admin: '#2a1e0a', adminText: '#d4943a', focusText: '#7a8fff',
};

const TAG_COLORS = {
  focus: { bg: C.focusBg, text: '#7a8fff' },
  work:  { bg: C.work,    text: C.workText },
  break: { bg: C.break,   text: C.breakText },
  admin: { bg: C.admin,   text: C.adminText },
};

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getNext7Days() {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function getTodayKey() {
  return formatDateKey(new Date());
}

function getUsageCount() {
  return globalThis._lockedInUsage || 0;
}

function incrementUsage() {
  const key = getTodayKey();
  if (globalThis._lockedInDate !== key) {
    globalThis._lockedInDate = key;
    globalThis._lockedInUsage = 0;
  }
  globalThis._lockedInUsage = (globalThis._lockedInUsage || 0) + 1;
  return globalThis._lockedInUsage;
}

function EventCard({ item, index }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;
  useState(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, delay: index * 50, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, delay: index * 50, useNativeDriver: true }),
    ]).start();
  });
  const tag = TAG_COLORS[item.category] || TAG_COLORS.work;
  return (
    <Animated.View style={[s.eventCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.eventLeft}>
        <View style={[s.eventDot, { backgroundColor: tag.text }]} />
        <View style={s.eventLine} />
      </View>
      <View style={s.eventRight}>
        <Text style={s.eventTime}>{item.time}</Text>
        <Text style={s.eventTitle}>{item.title}</Text>
        {item.note ? <Text style={s.eventNote}>{item.note}</Text> : null}
        <View style={[s.tag, { backgroundColor: tag.bg }]}>
          <Text style={[s.tagText, { color: tag.text }]}>{item.category}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

function PaywallModal({ visible, onClose, onPurchase, onRestore, packages, purchasing }) {
  const fallback = [
    { label: 'Pro Monthly', desc: 'Billed monthly', price: '$9.99/mo', highlight: true },
    { label: 'Pro Yearly', desc: 'Save 33% vs monthly', price: '$79.99/yr', highlight: false },
    { label: 'Business', desc: 'Teams & power users', price: '$49.99/mo', highlight: false },
  ];

  const plans = packages.length > 0 ? packages.map((pkg, i) => {
    const isYearly = pkg.identifier.includes('yearly') || pkg.identifier.includes('annual');
    const isMonthly = pkg.identifier.includes('monthly') && !pkg.identifier.includes('business');
    const isBusiness = pkg.identifier.includes('business');
    return (
      <TouchableOpacity key={i} style={[pw.planBtn, isMonthly && pw.planBtnHighlight]}
        onPress={() => onPurchase(pkg)} disabled={purchasing}>
        {isMonthly && <View style={pw.popularBadge}><Text style={pw.popularText}>MOST POPULAR</Text></View>}
        <View style={pw.planLeft}>
          <Text style={[pw.planName, isMonthly && pw.planNameHighlight]}>
            {isBusiness ? 'Business' : isYearly ? 'Pro Yearly' : 'Pro Monthly'}
          </Text>
          <Text style={pw.planDesc}>
            {isBusiness ? 'Teams & power users' : isYearly ? 'Save 33% vs monthly' : 'Billed monthly'}
          </Text>
        </View>
        <Text style={[pw.planPrice, isMonthly && pw.planPriceHighlight]}>{pkg.product.priceString}</Text>
      </TouchableOpacity>
    );
  }) : fallback.map((plan, i) => (
    <TouchableOpacity key={i} style={[pw.planBtn, plan.highlight && pw.planBtnHighlight]}
      onPress={() => onPurchase(null)} disabled={purchasing}>
      {plan.highlight && <View style={pw.popularBadge}><Text style={pw.popularText}>MOST POPULAR</Text></View>}
      <View style={pw.planLeft}>
        <Text style={[pw.planName, plan.highlight && pw.planNameHighlight]}>{plan.label}</Text>
        <Text style={pw.planDesc}>{plan.desc}</Text>
      </View>
      <Text style={[pw.planPrice, plan.highlight && pw.planPriceHighlight]}>{plan.price}</Text>
    </TouchableOpacity>
  ));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={pw.safe} edges={['top','bottom']}>
        <ScrollView contentContainerStyle={pw.content} showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={onClose} style={pw.closeBtn}>
            <Text style={pw.closeText}>✕</Text>
          </TouchableOpacity>
          <View style={pw.lockIcon}><Text style={pw.lockEmoji}>🔒</Text></View>
          <Text style={pw.title}>Unlock lockedIn Pro</Text>
          <Text style={pw.sub}>You've used your 3 free schedules today. Upgrade for unlimited access.</Text>
          <View style={pw.features}>
            {['Unlimited daily schedules','Direct iPhone Calendar sync','Smart break scheduling','Date planning for any day','Priority AI scheduling'].map((f,i) => (
              <View key={i} style={pw.featureRow}>
                <Text style={pw.featureCheck}>✓</Text>
                <Text style={pw.featureText}>{f}</Text>
              </View>
            ))}
          </View>
          {plans}
          {purchasing && <ActivityIndicator color={C.accent} style={{ marginTop: 16 }} />}
          <TouchableOpacity style={pw.restoreBtn} onPress={onRestore}>
            <Text style={pw.restoreText}>Restore Purchases</Text>
          </TouchableOpacity>
          <Text style={pw.legal}>Cancel anytime. Subscriptions auto-renew unless cancelled 24 hours before renewal.</Text>
          <View style={pw.legalLinks}>
            <TouchableOpacity onPress={() => Linking.openURL('https://github.com/jtorres-1/lockedin/blob/main/privacy-policy.md')}>
              <Text style={pw.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={pw.legalSep}> · </Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
              <Text style={pw.legalLink}>Terms of Use</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
  const [step, setStep] = useState('input');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isPro, setIsPro] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [packages, setPackages] = useState([]);
  const [purchasing, setPurchasing] = useState(false);
  const [usageCount, setUsageCount] = useState(getUsageCount());
  const scrollRef = useRef(null);
  const btnScale = useRef(new Animated.Value(1)).current;
  const days = getNext7Days();

  useEffect(() => {
    setupRevenueCat();
  }, []);

  const setupRevenueCat = async () => {
    try {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      Purchases.configure({ apiKey: RC_API_KEY, appUserID: null });
      const customerInfo = await Purchases.getCustomerInfo();
      setIsPro(customerInfo.entitlements.active['lockedin Pro'] !== undefined);
      const offerings = await Purchases.getOfferings();
      if (offerings.current?.availablePackages) {
        setPackages(offerings.current.availablePackages);
      }
    } catch (e) {
      console.log('RevenueCat setup error:', e);
    }
  };

  const handlePurchase = async (pkg) => {
    if (!pkg) {
      Alert.alert('Store Unavailable', 'Please check your connection and try again.');
      return;
    }
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active['lockedin Pro']) {
        setIsPro(true);
        setShowPaywall(false);
        Alert.alert('Welcome to Pro! 🎉', 'You now have unlimited access to lockedIn.');
      }
    } catch (e) {
      if (!e.userCancelled) Alert.alert('Purchase failed', e.message);
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    try {
      const { customerInfo } = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active['lockedin Pro']) {
        setIsPro(true);
        setShowPaywall(false);
        Alert.alert('Restored!', 'Your Pro access has been restored.');
      } else {
        Alert.alert('No purchases found', 'No active subscription found for this account.');
      }
    } catch (e) {
      Alert.alert('Restore failed', e.message);
    }
  };

  const pressIn = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true }).start();

  const generate = async () => {
    if (!tasks.trim()) { Alert.alert('Add some tasks first'); return; }

    if (!isPro) {
      const count = getUsageCount();
      if (count >= FREE_DAILY_LIMIT) {
        setShowPaywall(true);
        return;
      }
    }

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
          model: 'claude-sonnet-4-6',
          max_tokens: 1200,
          system: `You are a productivity scheduling assistant. Given tasks and preferences, produce a realistic time-blocked daily schedule.
Return ONLY a JSON array, no markdown, no preamble. Each item:
- "time": "9:00 AM - 10:00 AM"
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
      setSchedule(JSON.parse(clean));
      setStep('result');

      const newCount = incrementUsage();
      setUsageCount(newCount);

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
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow calendar access in Settings.'); setAdding(false); return; }
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const cal = calendars.find(c => c.allowsModifications && c.source?.name === 'Default')
        || calendars.find(c => c.allowsModifications) || calendars[0];
      if (!cal) { Alert.alert('No calendar found'); setAdding(false); return; }
      const ds = formatDateKey(selectedDate);
      let count = 0;
      for (const item of schedule) {
        try {
          const sv = (item.start_24||'0900').padStart(4,'0');
          const ev = (item.end_24||'1000').padStart(4,'0');
          await Calendar.createEventAsync(cal.id, {
            title: item.title,
            notes: item.note || '',
            startDate: new Date(`${ds}T${sv.slice(0,2)}:${sv.slice(2,4)}:00`),
            endDate: new Date(`${ds}T${ev.slice(0,2)}:${ev.slice(2,4)}:00`),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          count++;
        } catch(err) {}
      }
      setAdded(true);
      Alert.alert('Locked in 🔒', `${count} events added to your Calendar.`);
    } catch(e) { Alert.alert('Error', e.message); }
    finally { setAdding(false); }
  };

  const reset = () => { setStep('input'); setSchedule([]); setAdded(false); };
  const isToday = (d) => formatDateKey(d) === formatDateKey(new Date());
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usageCount);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Text style={s.logo}>locked<Text style={s.logoAccent}>In</Text></Text>
              {isPro ? (
                <View style={[s.pill, s.pillPro]}><Text style={[s.pillText, s.pillTextPro]}>PRO</Text></View>
              ) : (
                <View style={s.pill}><Text style={s.pillText}>AI SCHEDULER</Text></View>
              )}
            </View>
            <View style={s.headerRight}>
              {!isPro && step === 'input' && (
                <TouchableOpacity onPress={() => setShowPaywall(true)} style={s.upgradeBtn}>
                  <Text style={s.upgradeText}>Upgrade</Text>
                </TouchableOpacity>
              )}
              {step === 'result' && (
                <TouchableOpacity onPress={reset} style={s.resetBtn}>
                  <Text style={s.resetText}>New day</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Free tier indicator */}
          {!isPro && step === 'input' && (
            <View style={s.usageBar}>
              <Text style={s.usageText}>
                {remaining > 0 ? `${remaining} free schedule${remaining !== 1 ? 's' : ''} left today` : 'Daily limit reached — upgrade for unlimited'}
              </Text>
              <View style={s.usageDots}>
                {[0,1,2].map(i => (
                  <View key={i} style={[s.dot, i < usageCount && s.dotUsed]} />
                ))}
              </View>
            </View>
          )}

          {step === 'input' && (
            <>
              {/* Date selector */}
              <View style={s.dateSection}>
                <Text style={s.fieldLabel}>DATE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dateScroll} contentContainerStyle={s.dateScrollContent}>
                  {days.map((d, i) => {
                    const sel = formatDateKey(d) === formatDateKey(selectedDate);
                    return (
                      <TouchableOpacity key={i} onPress={() => setSelectedDate(d)} style={[s.dateChip, sel && s.dateChipSelected]}>
                        <Text style={[s.dateChipDay, sel && s.dateChipTextSelected]}>{isToday(d) ? 'Today' : DAYS[d.getDay()]}</Text>
                        <Text style={[s.dateChipNum, sel && s.dateChipTextSelected]}>{d.getDate()}</Text>
                        <Text style={[s.dateChipMonth, sel && s.dateChipTextSelected]}>{MONTHS[d.getMonth()]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Time row */}
              <View style={s.timeCard}>
                <View style={s.timeCol}>
                  <Text style={s.fieldLabel}>START</Text>
                  <TextInput style={s.timeInput} value={startTime} onChangeText={setStartTime} placeholderTextColor={C.textMuted} selectTextOnFocus />
                </View>
                <View style={s.timeDivider} />
                <View style={s.timeCol}>
                  <Text style={s.fieldLabel}>END</Text>
                  <TextInput style={s.timeInput} value={endTime} onChangeText={setEndTime} placeholderTextColor={C.textMuted} selectTextOnFocus />
                </View>
              </View>

              {/* Tasks */}
              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>TASKS — dump it all</Text>
                <TextInput
                  style={[s.input, s.textarea]}
                  multiline value={tasks} onChangeText={setTasks}
                  placeholder={'- Deep work (2 hrs)\n- Lunch\n- Client calls (1 hr)\n- Gym'}
                  placeholderTextColor={C.textMuted} textAlignVertical="top"
                />
              </View>

              {/* Prefs */}
              <View style={s.fieldGroup}>
                <Text style={s.fieldLabel}>PREFERENCES <Text style={s.optional}>optional</Text></Text>
                <TextInput style={s.input} value={prefs} onChangeText={setPrefs}
                  placeholder="deep work in morning, breaks between blocks"
                  placeholderTextColor={C.textMuted} />
              </View>

              {/* Generate */}
              <Animated.View style={{ transform: [{ scale: btnScale }] }}>
                <TouchableOpacity
                  style={[s.genBtn, loading && s.genBtnLoading]}
                  onPress={generate} onPressIn={pressIn} onPressOut={pressOut}
                  disabled={loading} activeOpacity={1}
                >
                  {loading ? (
                    <View style={s.loadingRow}>
                      <ActivityIndicator color={C.bg} size="small" />
                      <Text style={s.genBtnText}>  Building your day...</Text>
                    </View>
                  ) : (
                    <Text style={s.genBtnText}>
                      {!isPro && remaining === 0 ? 'Upgrade to Generate →' : 'Generate schedule →'}
                    </Text>
                  )}
                </TouchableOpacity>
              </Animated.View>
            </>
          )}

          {step === 'result' && schedule.length > 0 && (
            <>
              <View style={s.summaryBar}>
                <Text style={s.summaryText}>{DAYS[selectedDate.getDay()]} {MONTHS[selectedDate.getMonth()]} {selectedDate.getDate()}</Text>
                <Text style={s.summaryDot}>·</Text>
                <Text style={s.summaryText}>{schedule.length} blocks</Text>
                <Text style={s.summaryDot}>·</Text>
                <Text style={s.summaryText}>{startTime} – {endTime}</Text>
              </View>

              <View style={s.timeline}>
                {schedule.map((item, i) => <EventCard key={i} item={item} index={i} />)}
              </View>

              <TouchableOpacity
                style={[s.calBtn, added && s.calBtnDone]}
                onPress={addToCalendar} disabled={added || adding}
              >
                {adding ? <ActivityIndicator color={added ? C.breakText : C.bg} /> : (
                  <Text style={[s.calBtnText, added && s.calBtnTextDone]}>
                    {added ? '✓  Locked into Calendar' : '+  Add to iPhone Calendar'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={reset} style={s.newDayLink}>
                <Text style={s.newDayLinkText}>Plan a different day</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onPurchase={handlePurchase}
        onRestore={handleRestore}
        packages={packages}
        purchasing={purchasing}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 40, paddingTop: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 50 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', gap: 8 },
  logo: { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -1 },
  logoAccent: { color: C.accent },
  pill: { backgroundColor: C.accentDim, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(200,240,96,0.25)' },
  pillText: { fontSize: 8, fontWeight: '700', color: C.accent, letterSpacing: 1.2 },
  pillPro: { backgroundColor: 'rgba(200,240,96,0.2)', borderColor: C.accent },
  pillTextPro: { color: C.accent },
  upgradeBtn: { backgroundColor: C.accent, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5 },
  upgradeText: { fontSize: 12, color: C.bg, fontWeight: '700' },
  resetBtn: { backgroundColor: C.surface2, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: C.border },
  resetText: { fontSize: 12, color: C.textSub, fontWeight: '500' },

  usageBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.surface, borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  usageText: { fontSize: 12, color: C.textSub, flex: 1 },
  usageDots: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotUsed: { backgroundColor: C.accent },

  dateSection: { marginBottom: 12 },
  dateScroll: { marginHorizontal: -18 },
  dateScrollContent: { paddingHorizontal: 18, gap: 8 },
  dateChip: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 8, minWidth: 56 },
  dateChipSelected: { backgroundColor: C.accent, borderColor: C.accent },
  dateChipDay: { fontSize: 10, fontWeight: '600', color: C.textMuted, letterSpacing: 0.5 },
  dateChipNum: { fontSize: 20, fontWeight: '700', color: C.text, marginVertical: 1 },
  dateChipMonth: { fontSize: 10, fontWeight: '500', color: C.textMuted },
  dateChipTextSelected: { color: C.bg },

  timeCard: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12, overflow: 'hidden' },
  timeCol: { flex: 1, padding: 12 },
  timeDivider: { width: 1, backgroundColor: C.border, marginVertical: 8 },
  timeInput: { fontSize: 18, fontWeight: '600', color: C.text, marginTop: 3 },

  fieldGroup: { marginBottom: 10 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1.6, marginBottom: 6 },
  optional: { fontWeight: '400', color: C.textMuted, letterSpacing: 0 },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 12, color: C.text, fontSize: 14, padding: 12, lineHeight: 20 },
  textarea: { height: 110, textAlignVertical: 'top' },

  genBtn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4, shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 6 },
  genBtnLoading: { backgroundColor: 'rgba(200,240,96,0.7)' },
  genBtnText: { fontSize: 15, fontWeight: '700', color: C.bg, letterSpacing: 0.3 },
  loadingRow: { flexDirection: 'row', alignItems: 'center' },

  summaryBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  summaryText: { fontSize: 13, color: C.textSub, fontWeight: '500' },
  summaryDot: { fontSize: 13, color: C.textMuted },

  timeline: { marginBottom: 20 },
  eventCard: { flexDirection: 'row', marginBottom: 2 },
  eventLeft: { width: 18, alignItems: 'center', paddingTop: 3 },
  eventDot: { width: 7, height: 7, borderRadius: 4, marginBottom: 4 },
  eventLine: { flex: 1, width: 1, backgroundColor: C.border, marginBottom: -2 },
  eventRight: { flex: 1, paddingLeft: 12, paddingBottom: 18 },
  eventTime: { fontSize: 11, color: C.textMuted, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 3, letterSpacing: -0.2 },
  eventNote: { fontSize: 12, color: C.textSub, lineHeight: 17, marginBottom: 6 },
  tag: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },

  calBtn: { backgroundColor: C.accent, borderRadius: 12, padding: 15, alignItems: 'center', shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6 },
  calBtnDone: { backgroundColor: C.break, borderWidth: 1, borderColor: C.breakText, shadowOpacity: 0 },
  calBtnText: { fontSize: 15, fontWeight: '700', color: C.bg, letterSpacing: 0.3 },
  calBtnTextDone: { color: C.breakText },

  newDayLink: { alignItems: 'center', marginTop: 16 },
  newDayLinkText: { fontSize: 13, color: C.textMuted, fontWeight: '500' },
});

const pw = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16 },
  closeBtn: { alignSelf: 'flex-end', padding: 8 },
  closeText: { fontSize: 18, color: '#666' },
  lockIcon: { alignItems: 'center', marginTop: 8, marginBottom: 16 },
  lockEmoji: { fontSize: 52 },
  title: { fontSize: 26, fontWeight: '800', color: '#f5f2ed', textAlign: 'center', letterSpacing: -0.5, marginBottom: 8 },
  sub: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  features: { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#222' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  featureCheck: { fontSize: 14, color: '#c8f060', fontWeight: '700' },
  featureText: { fontSize: 14, color: '#ccc' },
  planBtn: { backgroundColor: '#161616', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#2a2a2a', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planBtnHighlight: { backgroundColor: '#1a1f0a', borderColor: '#c8f060', borderWidth: 1.5 },
  popularBadge: { position: 'absolute', top: -10, left: 16, backgroundColor: '#c8f060', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  popularText: { fontSize: 9, fontWeight: '800', color: '#0a0a0a', letterSpacing: 1 },
  planLeft: { flex: 1 },
  planName: { fontSize: 16, fontWeight: '700', color: '#f5f2ed', marginBottom: 2 },
  planNameHighlight: { color: '#c8f060' },
  planDesc: { fontSize: 12, color: '#666' },
  planPrice: { fontSize: 18, fontWeight: '700', color: '#f5f2ed' },
  planPriceHighlight: { color: '#c8f060' },
  restoreBtn: { alignItems: 'center', marginTop: 16, marginBottom: 12 },
  restoreText: { fontSize: 13, color: '#555' },
  legal: { fontSize: 11, color: '#444', textAlign: 'center', lineHeight: 16 },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  legalLink: { fontSize: 11, color: '#666', textDecorationLine: 'underline' },
  legalSep: { fontSize: 11, color: '#444' },
});