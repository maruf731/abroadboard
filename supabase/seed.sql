-- ============================================================================
-- abroadboard: sample events, posts, Buy and Sell listings and food tips
-- Run this in Supabase Dashboard > SQL Editor AFTER schema.sql, and after at
-- least one person has signed up (ideally an admin). The samples are posted
-- under that account's name. Safe to run again: it skips samples that exist.
--
-- Posts disappear after 21 days and events once they're over, so run it again
-- later if you want fresh samples (event dates are counted from today).
-- ============================================================================

do $$
declare
  host uuid;
begin
  -- Post as the first admin, or the first person who signed up.
  select id into host from public.profiles
  order by is_admin desc, created_at
  limit 1;

  if host is null then
    raise exception 'No accounts yet. Sign up on the site once, then run this file again.';
  end if;

  -- Events (Events page)
  insert into public.events (title, event_date, venue, blurb, host_id)
  select v.title, current_date + v.days, v.venue, v.blurb, host
  from (values
    ('International welcome potluck', 3, 'Albert Park, by the fountain',
     'Bring a dish from home and meet other new arrivals from every Auckland campus. Plates and cutlery provided.'),
    ('Sunset walk up Maungawhau / Mt Eden', 6, 'Meet at the Mt Eden summit car park',
     'An easy 30-minute walk to the top for city views at sunset. Wear good shoes and bring a jacket.'),
    ('Language exchange night', 9, 'Central city library, level 2',
     'Practise English or teach a bit of your own language. Tables for Mandarin, Hindi, Korean, Spanish and more.'),
    ('Budget grocery walk', 12, 'Meet outside Britomart station',
     'We visit two supermarkets and a vege market and compare prices for a week of meals. Bring a reusable bag.')
  ) as v(title, days, venue, blurb)
  where not exists (select 1 from public.events e where e.title = v.title);

  -- Meetup posts (Board)
  insert into public.posts (section, category, sport, title, body, contact, author_id)
  select 'board',
         case v.title when 'Rangitoto hike this Sunday, who''s in?' then 'Weekend and day trips'
                      when 'Casual cricket in the Domain, Saturday 2pm' then 'Sports'
                      when 'Weekly study session at the library' then 'Study partners'
                      else 'Coffee and chat' end,
         case when v.title like 'Casual cricket%' then 'Cricket' end,
         v.title, v.body, v.contact, host
  from (values
    ('Rangitoto hike this Sunday, who''s in?',
     'Catching the morning ferry from downtown and walking to the summit. Slow pace with lots of photo stops. Bring water and lunch.',
     'Reply here or message on the board'),
    ('Casual cricket in the Domain, Saturday 2pm',
     'All levels welcome. We have a bat and tennis balls. Look for the red umbrella near the duck pond.',
     'Just turn up'),
    ('Board games and snacks from home, Friday night',
     'Catan, Codenames and Uno, plus food from our home countries to share. Around 8 people so far, room for more.',
     'Reply here to get the address'),
    ('Weekly study session at the library',
     'Students from any institution welcome. Quiet study with a coffee break every hour. Tuesdays 6 to 9pm.',
     'Look for the abroadboard sign on the table')
  ) as v(title, body, contact)
  where not exists (select 1 from public.posts p where p.title = v.title);
  -- More events
  insert into public.events (title, event_date, venue, blurb, host_id)
  select v.title, current_date + v.days, v.venue, v.blurb, host
  from (values
    ('Night market food crawl', 9, 'Meet at the night market entrance',
     'Try street food from a dozen countries for under $20. We will split into small groups so nobody gets lost.'),
    ('Free museum afternoon', 13, 'Auckland War Memorial Museum, main entrance',
     'Entry is free for Auckland residents with ID. We will visit the Māori Court and the volcanoes gallery together.')
  ) as v(title, days, venue, blurb)
  where not exists (select 1 from public.events e where e.title = v.title);

  -- Board posts in other categories, Buy and Sell listings and food tips.
  -- Contact details stay hidden; requests go to the account the samples are posted under.
  with v(section, category, title, body, price, condition, gender, sleeper, note) as (values
    ('board', 'Flatmates and rooms', 'Room available in a Mt Eden flat from 1 November',
     'Furnished double room in a 3-bedroom flat, 10 minutes by bus to the city. $230 a week including power and Wi-Fi. Looking for a tidy, quiet flatmate.',
     null, null, 'any', 'light', 'Non-smoker'),
    ('board', 'Flatmates and rooms', 'Looking for a third flatmate near the city campuses',
     'Two students looking for one more person to share a 3-bedroom apartment in the CBD from December. About $260 a week each.',
     null, null, 'women', 'any', null),
    ('board', 'Study partners', 'Statistics study partner wanted',
     'Taking first-year statistics and want someone to go through tutorial questions with. Weekdays after 4pm at any city library.',
     null, null, 'any', 'any', null),
    ('board', 'Study partners', 'IELTS speaking practice partner',
     'Preparing for the IELTS speaking test. Happy to meet twice a week on campus or online to practise together.',
     null, null, 'any', 'any', null),
    ('board', 'Questions and advice', 'Which mobile plan is best for students?',
     'Just arrived and need a SIM card. Which provider gives the best value for data and for calling home?',
     null, null, 'any', 'any', null),
    ('board', 'Questions and advice', 'How do I get an IRD number for part-time work?',
     'Got my first casual job offer. What documents did you need, and how long did it take?',
     null, null, 'any', 'any', null),
    ('market', 'Furniture', 'Study desk and chair',
     'White desk, 120 cm wide, with a matching chair. Pick up in Newmarket.',
     '$45', 'Good', 'any', 'any', null),
    ('market', 'Electronics', '27-inch monitor with HDMI cable',
     'Barely used and works perfectly. Great as a second screen for assignments.',
     '$90', 'Like new', 'any', 'any', null),
    ('market', 'Books & study', 'First-year economics textbook',
     'Some highlighting in the first chapters, otherwise clean. Pick up on campus.',
     '$25', 'Good', 'any', 'any', null),
    ('market', 'Kitchen', 'Rice cooker and kettle bundle',
     'Both work perfectly. Leaving New Zealand in December.',
     '$20', 'Good', 'any', 'any', null),
    ('market', 'Bikes & transport', 'City bike with lock and helmet',
     'Gears work well, a few small scratches. Fits riders about 160 to 180 cm tall.',
     '$120', 'Fair', 'any', 'any', null),
    ('food', 'Tip', 'Supermarket markdowns after 7pm',
     'Bakery and deli items are often reduced near closing time. Look for the yellow stickers.',
     'Up to 50% off', null, 'any', 'any', null),
    ('food', 'Tip', 'Weekend vege market',
     'Buy a week of fruit and vegetables in one trip. Go near closing time for the best deals.',
     '~$20/week', null, 'any', 'any', null),
    ('food', 'Tip', 'Cook-once, eat-three-times dal',
     'Lentils, onion, tomato and spices. Freezes well and costs very little per serve.',
     '~$2/serve', null, 'any', 'any', null),
    ('food', 'Tip', 'Bring your own lunch box',
     'Most campuses have microwaves in student lounges. Packing lunch can save around $60 a week.',
     'Free', null, 'any', 'any', null)
  ), ins as (
    insert into public.posts (section, category, title, body, price, condition, audience_gender, audience_sleeper,
                              audience_note, contact_methods, author_id)
    select v.section, v.category, v.title, v.body, v.price, v.condition, v.gender, v.sleeper, v.note,
           case when v.section = 'food' then '{}'::text[] else array['email'] end, host
    from v
    where not exists (select 1 from public.posts p where p.title = v.title)
    returning id, section
  )
  insert into public.post_contacts (post_id, email)
  select id, 'info@abroadboard.com' from ins where section <> 'food';
end;
$$;

-- Board posts for every category in the October 2026 category list (FC-44).
do $$
declare
  host uuid;
begin
  select id into host from public.profiles order by is_admin desc, created_at limit 1;
  if host is null then
    raise exception 'No accounts yet. Sign up on the site once, then run this file again.';
  end if;

  with v(category, sport, title, body, gender, sleeper, note) as (values
    ('Coffee and chat', null, 'Coffee after Monday lectures?',
     'New to Auckland and keen to meet people outside class. I usually grab a flat white near Shortland Street around 3pm on Mondays. Come say hi.',
     'any', 'any', null),
    ('Weekend and day trips', null, 'Day trip to Piha beach on Saturday',
     'Two of us are driving out to Piha and have three spare seats. Leaving the city at 9am and back before dinner. Share petrol, about $10 each.',
     'any', 'any', null),
    ('Language exchange', null, 'Can teach Hindi, want to practise Spanish',
     'I''m a native Hindi speaker learning Spanish. Happy to meet once a week for an hour, half in each language. Any level is fine.',
     'any', 'any', null),
    ('Language exchange', null, 'Korean and English conversation partner',
     'I want to improve my English speaking and can help you with Korean. Cafe on campus or a video call, whatever suits you.',
     'any', 'any', null),
    ('Cultural and religious', null, 'Diwali night, everyone welcome',
     'Lights, sweets and music at our flat common room. Bring a friend and a small plate of food if you can. No need to RSVP.',
     'any', 'any', null),
    ('Cultural and religious', null, 'Friday prayers and lunch group',
     'A few of us walk to the mosque together on Fridays and have lunch afterwards. New students welcome to join us.',
     'men', 'any', null),
    ('Sports', 'Football (soccer)', '5-a-side this Sunday, need 2 more players',
     'Casual game at the Domain sports fields, 4pm. Mixed ability, just for fun. Bring water and running shoes.',
     'any', 'any', null),
    ('Sports', 'Badminton', 'Looking for a badminton doubles partner',
     'I play twice a week at the rec centre and my partner just graduated. Intermediate level, happy to split court fees.',
     'women', 'any', null),
    ('Sports', 'Gym and fitness', 'Gym buddy for early mornings',
     'Training at the campus gym at 6:30am on weekdays. Looking for someone to keep me motivated. Beginners welcome.',
     'any', 'any', null),
    ('Moving in and out', null, 'Selling a desk and chair before I fly home',
     'Leaving Auckland at the end of semester. Desk, chair, lamp and a small bookshelf. Pick up from Grafton, cheap for a quick sale.',
     'any', 'any', null),
    ('Moving in and out', null, 'Need help moving boxes on Saturday',
     'Moving from Mt Albert to the city. About ten boxes and a mattress. I''ll pay for pizza and petrol if you have a car.',
     'any', 'any', null),
    ('Part-time jobs', null, 'Cafe on Queen Street hiring for weekends',
     'The cafe I work at needs another barista for Saturday and Sunday mornings. Training given. Ask me for the manager''s details.',
     'any', 'any', null),
    ('Part-time jobs', null, 'Campus library is looking for student helpers',
     'Shelving books and helping at the front desk, around 10 hours a week. Good for students on a visa with work rights.',
     'any', 'any', null),
    ('Discounts and deals', null, 'Student discount at a local gym',
     'Show your student ID at the gym on Symonds Street for half-price membership in your first month.',
     'any', 'any', null),
    ('Discounts and deals', null, 'Half-price movie tickets on Tuesdays',
     'Most cinemas in the city have cheap Tuesdays and an extra student price. Worth checking before you book.',
     'any', 'any', null),
    ('Textbooks and notes', null, 'Selling a circuit analysis textbook',
     'Used for one semester, no writing inside. Comes with my printed lecture notes for free.',
     'any', 'any', null),
    ('Textbooks and notes', null, 'Swapping first-year accounting notes',
     'I have neat notes for first-year accounting and want notes for business statistics in return.',
     'any', 'any', null),
    ('Tutoring', null, 'Offering maths tutoring',
     'Third-year maths student. I can help with calculus and algebra for first-year courses. $25 an hour, first session free.',
     'any', 'any', null),
    ('Tutoring', null, 'Need help with academic writing',
     'Looking for someone to check the structure of my essays before I submit them. Happy to pay or swap for help with coding.',
     'any', 'any', null),
    ('Rides and transport', null, 'Sharing a ride to the airport',
     'Flying out on the 20th, leaving the city around 6am. Anyone want to split an Uber? Should be about $25 each.',
     'any', 'any', null),
    ('Rides and transport', null, 'Best way to get to the North Shore campus?',
     'Moving to Albany next semester. Is the Northern Express bus reliable, or is it worth carpooling?',
     'any', 'any', null),
    ('Lost and found', null, 'Found a student card at the library',
     'Found near the level 2 printers on Tuesday afternoon. Message me with the name on the card and I''ll return it.',
     'any', 'any', null),
    ('Lost and found', null, 'Lost a black umbrella on the Link bus',
     'Plain black umbrella with a wooden handle. Lost on the Inner Link on Wednesday. It means a lot to me.',
     'any', 'any', null),
    ('Other', null, 'Anyone want to start a photography walk group?',
     'I''d like to explore Auckland''s street art and parks with a camera. Phone cameras totally fine.',
     'any', 'any', null)
  ), ins as (
    insert into public.posts (section, category, sport, title, body, audience_gender, audience_sleeper,
                              audience_note, contact_methods, author_id)
    select 'board', v.category, v.sport, v.title, v.body, v.gender, v.sleeper, v.note, array['email'], host
    from v
    where not exists (select 1 from public.posts p where p.title = v.title)
    returning id
  )
  insert into public.post_contacts (post_id, email)
  select id, 'info@abroadboard.com' from ins;
end;
$$;
